import { useEffect, useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, schoolFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useTableSort } from "@/hooks/use-table-sort";
import { SortableTableHead } from "@/components/sortable-table-head";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BookOpen,
  Plus,
  FileText,
  Video,
  Link as LinkIcon,
  Search,
  Download,
  Trash2,
  Pencil,
  RotateCcw,
  AlertTriangle,
  BookCopy,
  Users,
  DollarSign,
  Clock,
  Library,
  ArrowRightLeft,
  Globe,
  Ban,
  CheckCircle2,
  Tag,
  XCircle,
  MoreHorizontal,
  Camera,
  CalendarClock,
  BookMarked,
  ImagePlus,
  Settings,
  Upload,
  FileSpreadsheet,
  Check,
  BellRing,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { QrScannerDialog } from "@/components/qr-scanner";
import type {
  LibraryResource,
  LibraryBook,
  LibraryBookCopy,
  LibraryCategory,
  LibraryLoan,
  LibraryFine,
  LibraryReservation,
  LibraryPolicy,
  LibraryShelf,
  Subject,
  Student,
  Staff,
  Stream,
  Class,
  School,
} from "@shared/schema";
import { normalizeSchoolType } from "@shared/academic-profiles";
import { useAuth } from "@/lib/auth";

function formatDate(date: string | Date | null | undefined) {
  if (!date) return "-";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function toDateTimeLocalValue(date: string | Date | null | undefined) {
  const parsed = date ? new Date(date) : new Date();
  if (Number.isNaN(parsed.getTime())) return "";
  const offsetMs = parsed.getTimezoneOffset() * 60 * 1000;
  return new Date(parsed.getTime() - offsetMs).toISOString().slice(0, 16);
}

function getDefaultDueDate() {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return toDateTimeLocalValue(d);
}

function getLoanStatusBadge(status: string | null, dueDate?: string | null) {
  if (status === "active" && dueDate && new Date(dueDate) < new Date()) {
    return <Badge variant="destructive" data-testid="badge-overdue">Overdue</Badge>;
  }
  switch (status) {
    case "active":
      return <Badge variant="default" data-testid="badge-active">Active</Badge>;
    case "returned":
      return <Badge variant="secondary" data-testid="badge-returned">Returned</Badge>;
    case "overdue":
      return <Badge variant="destructive" data-testid="badge-overdue">Overdue</Badge>;
    case "lost":
      return <Badge variant="outline" data-testid="badge-lost">Lost</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function getFineStatusBadge(status: string | null) {
  switch (status) {
    case "unpaid":
      return <Badge variant="destructive" data-testid="badge-unpaid">Unpaid</Badge>;
    case "paid":
      return <Badge variant="default" data-testid="badge-paid">Paid</Badge>;
    case "waived":
      return <Badge variant="secondary" data-testid="badge-waived">Waived</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function getCopyStatusBadge(status: string | null | undefined) {
  switch (status) {
    case "available":
      return <Badge className="bg-green-600 hover:bg-green-600 text-white">available</Badge>;
    case "borrowed":
      return <Badge className="bg-blue-600 hover:bg-blue-600 text-white">borrowed</Badge>;
    case "damaged":
      return <Badge variant="destructive">damaged</Badge>;
    case "lost":
      return <Badge variant="outline">lost</Badge>;
    default:
      return <Badge variant="outline">{status || "unknown"}</Badge>;
  }
}

export default function LibraryPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("catalog");
  const [isLibrarySetupOpen, setIsLibrarySetupOpen] = useState(false);
  const [librarySetupTab, setLibrarySetupTab] = useState("policies");

  const openLibrarySetup = (tab: string = "policies") => {
    setLibrarySetupTab(tab);
    setIsLibrarySetupOpen(true);
  };

  const { data: books = [], isLoading: booksLoading } = useQuery<LibraryBook[]>({
    queryKey: ["/api/library/books"],
  });
  const { data: categories = [] } = useQuery<LibraryCategory[]>({
    queryKey: ["/api/library/categories"],
  });
  const { data: loans = [], isLoading: loansLoading } = useQuery<LibraryLoan[]>({
    queryKey: ["/api/library/loans"],
  });
  const { data: fines = [], isLoading: finesLoading } = useQuery<LibraryFine[]>({
    queryKey: ["/api/library/fines"],
  });
  const { data: resources = [], isLoading: resourcesLoading } = useQuery<LibraryResource[]>({
    queryKey: ["/api/library/resources"],
  });
  const { data: reservations = [] } = useQuery<LibraryReservation[]>({
    queryKey: ["/api/library/reservations"],
  });
  const currentSchoolId = typeof window !== "undefined" ? localStorage.getItem("currentSchoolId") : null;
  const { data: currentSchool } = useQuery<School>({
    queryKey: ["/api/schools/current", currentSchoolId],
    enabled: !!currentSchoolId,
    queryFn: async () => {
      const res = await schoolFetch("/api/schools/current");
      if (!res.ok) throw new Error("Failed to fetch current school");
      return res.json();
    },
  });
  const resolvedSchoolType = normalizeSchoolType(currentSchool?.schoolType);

  const { data: subjects = [] } = useQuery<Subject[]>({
    queryKey: ["/api/subjects", currentSchoolId, "library"],
    queryFn: async () => {
      const res = await schoolFetch("/api/subjects?perPage=500");
      if (!res.ok) throw new Error("Failed to fetch subjects");
      const payload = await res.json();
      return Array.isArray(payload) ? payload : (payload?.items ?? []);
    },
  });
  const { data: classesList = [] } = useQuery<Class[]>({
    queryKey: ["/api/classes", currentSchoolId, "library"],
    queryFn: async () => {
      const res = await schoolFetch("/api/classes");
      if (!res.ok) throw new Error("Failed to fetch classes");
      const payload = await res.json();
      return Array.isArray(payload) ? payload : (payload?.items ?? []);
    },
  });
  const { data: streamsList = [] } = useQuery<Stream[]>({
    queryKey: ["/api/streams", resolvedSchoolType, currentSchoolId, "library"],
    enabled: !!resolvedSchoolType,
    queryFn: async () => {
      const res = await schoolFetch(`/api/streams?schoolType=${resolvedSchoolType}`);
      if (!res.ok) throw new Error("Failed to fetch streams");
      const payload = await res.json();
      return Array.isArray(payload) ? payload : (payload?.items ?? []);
    },
  });
  const { data: studentsList = [] } = useQuery<Student[]>({
    queryKey: ["/api/students"],
  });
  const { data: staffList = [] } = useQuery<Staff[]>({
    queryKey: ["/api/staff"],
  });

  const [personLookupRecord, setPersonLookupRecord] = useState<
    | { type: "student"; person: Student }
    | { type: "staff"; person: Staff }
    | null
  >(null);

  const handlePersonCodeScan = (rawCode: string) => {
    const code = rawCode.trim().toLowerCase();
    if (!code) return false;

    const matchedStudent = studentsList.find((student) => String(student.admissionNo || "").trim().toLowerCase() === code);
    if (matchedStudent) {
      setPersonLookupRecord({ type: "student", person: matchedStudent });
      return true;
    }

    const matchedStaff = staffList.find((member) => String(member.staffNo || "").trim().toLowerCase() === code);
    if (matchedStaff) {
      setPersonLookupRecord({ type: "staff", person: matchedStaff });
      return true;
    }

    return false;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Library className="h-8 w-8" style={{ color: "#1b2a5c" }} />
        <div>
          <h1 className="text-3xl font-bold tracking-tight" style={{ color: "#1b2a5c" }} data-testid="text-library-title">Library</h1>
          <p className="text-muted-foreground">Manage books, circulation, digital resources and fines</p>
        </div>
      </div>

      <DashboardTab books={books} loans={loans} fines={fines} booksLoading={booksLoading} loansLoading={loansLoading} subjects={subjects} classes={classesList} streams={streamsList} />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mx-auto flex w-fit gap-4 mb-4">
          <TabsTrigger value="catalog" data-testid="tab-catalog">
            <BookOpen className="h-4 w-4 mr-1" /> Catalogue
          </TabsTrigger>
          <TabsTrigger value="circulation" data-testid="tab-circulation">
            <ArrowRightLeft className="h-4 w-4 mr-1" /> Circulation
          </TabsTrigger>
          <TabsTrigger value="digital" data-testid="tab-digital">
            <Globe className="h-4 w-4 mr-1" /> Digital Resources
          </TabsTrigger>
          <TabsTrigger value="fines" data-testid="tab-fines">
            <DollarSign className="h-4 w-4 mr-1" /> Fines
          </TabsTrigger>
          <TabsTrigger value="reservations" data-testid="tab-reservations">
            <CalendarClock className="h-4 w-4 mr-1" /> Reservations
          </TabsTrigger>
        </TabsList>

        <TabsContent value="catalog" className="mt-4">
          <CatalogTab
            books={books}
            categories={categories}
            subjects={subjects}
            classes={classesList}
            streams={streamsList}
            booksLoading={booksLoading}
            onOpenLibrarySetup={openLibrarySetup}
            onScanPersonCode={handlePersonCodeScan}
          />
        </TabsContent>
        <TabsContent value="circulation" className="mt-4">
          <CirculationTab
            loans={loans}
            books={books}
            fines={fines}
            students={studentsList}
            staff={staffList}
            loansLoading={loansLoading}
            onOpenLibrarySetup={openLibrarySetup}
            onScanPersonCode={handlePersonCodeScan}
          />
        </TabsContent>
        <TabsContent value="digital" className="mt-4">
          <DigitalResourcesTab resources={resources} subjects={subjects} isLoading={resourcesLoading} />
        </TabsContent>
        <TabsContent value="fines" className="mt-4">
          <FinesTab fines={fines} loans={loans} finesLoading={finesLoading} />
        </TabsContent>
        <TabsContent value="reservations" className="mt-4">
          <ReservationsTab reservations={reservations} books={books} students={studentsList} staff={staffList} />
        </TabsContent>
      </Tabs>

      <LibrarySetupModal
        open={isLibrarySetupOpen}
        onOpenChange={setIsLibrarySetupOpen}
        activeTab={librarySetupTab}
        onTabChange={setLibrarySetupTab}
        categories={categories}
      />

      <BorrowerLookupDialog
        open={!!personLookupRecord}
        onOpenChange={(open) => {
          if (!open) setPersonLookupRecord(null);
        }}
        record={personLookupRecord}
        loans={loans}
        books={books}
        classes={classesList}
      />
    </div>
  );
}

function BorrowerLookupDialog({
  open,
  onOpenChange,
  record,
  loans,
  books,
  classes,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  record: { type: "student"; person: Student } | { type: "staff"; person: Staff } | null;
  loans: LibraryLoan[];
  books: LibraryBook[];
  classes: Class[];
}) {
  if (!record) return null;

  const person = record.person;
  const fullName = `${person.firstName} ${person.lastName}`.trim();
  const outstandingLoans = loans.filter((loan) =>
    loan.borrowerType === record.type &&
    loan.borrowerId === person.id &&
    ["active", "overdue", "lost"].includes(String(loan.status))
  );

  const className = record.type === "student"
    ? (classes.find((cls) => cls.id === record.person.classId)?.className || "-")
    : ((record.person as Staff).role || "-");

  const codeLabel = record.type === "student" ? "Admission No" : "Staff No";
  const codeValue = record.type === "student" ? record.person.admissionNo : (record.person as Staff).staffNo;
  const imageUrl = person.photo || "";
  const genderValue = person.gender || "-";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{record.type === "student" ? "Student Borrowing Lookup" : "Staff Borrowing Lookup"}</DialogTitle>
          <DialogDescription>
            Read-only identity details and all books currently on loan for this person.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted">
              {imageUrl ? (
                <img src={imageUrl} alt={fullName} className="h-full w-full object-cover" />
              ) : (
                <span className="text-xl font-semibold text-muted-foreground">
                  {fullName.split(" ").map((part) => part.charAt(0)).join("").slice(0, 2) || "?"}
                </span>
              )}
            </div>

            <div className="grid flex-1 gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Name</p>
                <p className="text-sm font-semibold">{fullName || "-"}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{codeLabel}</p>
                <p className="text-sm">{codeValue || "-"}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{record.type === "student" ? "Class" : "Role"}</p>
                <p className="text-sm">{className}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Gender</p>
                <p className="text-sm capitalize">{String(genderValue)}</p>
              </div>
            </div>
          </div>
        </div>

        {outstandingLoans.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
            This {record.type === "student" ? "student" : "staff member"} has no books borrowed currently.
          </div>
        ) : (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Books currently borrowed</h3>
            <div className="space-y-3">
              {outstandingLoans.map((loan) => {
                const bookTitle = books.find((book) => book.id === loan.bookId)?.title || `Book #${loan.bookId}`;
                return (
                  <div key={loan.id} className="rounded-lg border p-3 space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{bookTitle}</p>
                      {getLoanStatusBadge(loan.status, loan.dueDate as any)}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      <span className="font-semibold">Copy ID:</span> {loan.copyId || "-"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      <span className="font-semibold">Issue Date:</span> {formatDate(loan.issuedAt)} | <span className="font-semibold">Due Date:</span> {formatDate(loan.dueDate)}
                    </p>
                    {loan.markedLostAt ? (
                      <p className="text-sm text-muted-foreground">
                        <span className="font-semibold">Marked Lost/Stolen On:</span> {formatDate(loan.markedLostAt)}
                        {loan.markedRecoveredAt ? (
                          <>
                            {" | "}
                            <span className="font-semibold">Marked Recovered On:</span> {formatDate(loan.markedRecoveredAt)}
                          </>
                        ) : null}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DashboardTab({
  books,
  loans,
  fines,
  booksLoading,
  loansLoading,
}: {
  books: LibraryBook[];
  loans: LibraryLoan[];
  fines: LibraryFine[];
  booksLoading: boolean;
  loansLoading: boolean;
  subjects: Subject[];
  classes: Class[];
  streams: Stream[];
}) {
  const totalBooks = books.length;
  const availableCopies = books.reduce((sum, b) => sum + (b.availableCopies || 0), 0);
  const activeLoans = loans.filter((l) => l.status === "active").length;
  const overdueLoans = loans.filter(
    (l) => l.status === "active" && l.dueDate && new Date(l.dueDate) < new Date()
  ).length + loans.filter((l) => l.status === "overdue").length;
  const damagedCopies = books.reduce((sum, b) => sum + (b.damagedCopies || 0), 0);
  const lostStolenCopies = books.reduce((sum, b) => sum + (b.lostStolenCopies || 0), 0);
  const unpaidFines = fines.filter((f) => f.status === "unpaid");
  const unpaidTotal = unpaidFines.reduce((sum, f) => sum + parseFloat(f.amount), 0);
  const paidFines = fines.filter((f) => f.status === "paid");
  const paidTotal = paidFines.reduce((sum, f) => sum + parseFloat(f.amount), 0);

  if (booksLoading || loansLoading) {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:flex lg:flex-nowrap lg:justify-between lg:gap-3">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <Skeleton key={i} className="h-[76px] w-full lg:h-[84px] lg:w-[175px] lg:flex-none" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:flex lg:flex-nowrap lg:justify-between lg:gap-3">
      <Card className="lg:w-[200px] lg:flex-none">
        <CardContent className="px-3.5 py-2.5">
          <div className="flex items-center gap-3.5">
            <div className="h-10 w-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <BookOpen className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-[13px] leading-tight text-muted-foreground">Total Books</p>
              <p className="text-sm font-bold" data-testid="stat-total-books">{totalBooks}</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card className="lg:w-[200px] lg:flex-none">
        <CardContent className="px-3.5 py-2.5">
          <div className="flex items-center gap-3.5">
            <div className="h-10 w-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <BookCopy className="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-[13px] leading-tight text-muted-foreground">Available Copies</p>
              <p className="text-sm font-bold" data-testid="stat-available-copies">{availableCopies}</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card className="lg:w-[200px] lg:flex-none">
        <CardContent className="px-3.5 py-2.5">
          <div className="flex items-center gap-3.5">
            <div className="h-10 w-10 rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center">
              <Users className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
            </div>
            <div>
              <p className="text-[13px] leading-tight text-muted-foreground">Borrowed Copies</p>
              <p className="text-sm font-bold" data-testid="stat-borrowed">{activeLoans}</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card className="lg:w-[200px] lg:flex-none">
        <CardContent className="px-3.5 py-2.5">
          <div className="flex items-center gap-3.5">
            <div className="h-10 w-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <p className="text-[13px] leading-tight text-muted-foreground">Overdue Copies</p>
              <p className="text-sm font-bold" data-testid="stat-overdue">{overdueLoans}</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card className="lg:w-[200px] lg:flex-none">
        <CardContent className="px-3.5 py-2.5">
          <div className="flex items-center gap-3.5">
            <div className="h-10 w-10 rounded-full bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center">
              <BookMarked className="h-5 w-5 text-rose-600 dark:text-rose-400" />
            </div>
            <div>
              <p className="text-[13px] leading-tight text-muted-foreground">Damaged Copies</p>
              <p className="text-sm font-bold" data-testid="stat-damaged-copies">{damagedCopies}</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card className="lg:w-[200px] lg:flex-none">
        <CardContent className="px-3.5 py-2.5">
          <div className="flex items-center gap-3.5">
            <div className="h-10 w-10 rounded-full bg-slate-100 dark:bg-slate-900/30 flex items-center justify-center">
              <XCircle className="h-5 w-5 text-slate-600 dark:text-slate-400" />
            </div>
            <div>
              <p className="text-[13px] leading-tight text-muted-foreground">Lost/Stolen Copies</p>
              <p className="text-sm font-bold" data-testid="stat-lost-stolen-copies">{lostStolenCopies}</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card className="lg:w-[200px] lg:flex-none">
        <CardContent className="px-3.5 py-2.5">
          <div className="flex items-center gap-3.5">
            <div className="h-10 w-10 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
              <DollarSign className="h-5 w-5 text-orange-600 dark:text-orange-400" />
            </div>
            <div>
              <p className="text-[13px] leading-tight text-muted-foreground">Unpaid Fines</p>
              <p className="text-sm font-bold" data-testid="stat-unpaid-fines">
                {unpaidFines.length} (${unpaidTotal.toFixed(2)})
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card className="lg:w-[200px] lg:flex-none">
        <CardContent className="px-3.5 py-2.5">
          <div className="flex items-center gap-3.5">
            <div className="h-10 w-10 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="text-[13px] leading-tight text-muted-foreground">Paid Fines</p>
              <p className="text-sm font-bold" data-testid="stat-paid-fines">
                {paidFines.length} (${paidTotal.toFixed(2)})
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function LibrarySetupModal({
  open,
  onOpenChange,
  activeTab,
  onTabChange,
  categories,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeTab: string;
  onTabChange: (tab: string) => void;
  categories: LibraryCategory[];
}) {
  const { toast } = useToast();
  const [editingCategory, setEditingCategory] = useState<LibraryCategory | null>(null);
  const [newCatName, setNewCatName] = useState("");
  const [newCatDesc, setNewCatDesc] = useState("");
  const [editingShelf, setEditingShelf] = useState<LibraryShelf | null>(null);
  const [shelfName, setShelfName] = useState("");
  const [shelfDescription, setShelfDescription] = useState("");
  const { data: shelves = [] } = useQuery<LibraryShelf[]>({ queryKey: ["/api/library/shelves"] });
  const { data: libraryPolicy } = useQuery<LibraryPolicy>({ queryKey: ["/api/library/policy"] });
  const savePolicy = useMutation({ mutationFn: async (data: Record<string, unknown>) => { const res = await schoolFetch("/api/library/policy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }); if (!res.ok) throw new Error("Failed to save policy"); return res.json(); }, onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/library/policy"] }); toast({ title: "Library policy saved" }); }, onError: () => toast({ title: "Failed to save policy", variant: "destructive" }) });
  const createCategory = useMutation({ mutationFn: async (data: { name: string; description?: string }) => apiRequest("POST", "/api/library/categories", data), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/library/categories"] }); setNewCatName(""); setNewCatDesc(""); toast({ title: "Category added" }); } });
  const updateCategory = useMutation({ mutationFn: async ({ id, data }: { id: number; data: { name: string; description?: string } }) => apiRequest("PUT", `/api/library/categories/${id}`, data), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/library/categories"] }); setEditingCategory(null); setNewCatName(""); setNewCatDesc(""); toast({ title: "Category updated" }); } });
  const deleteCategory = useMutation({ mutationFn: async (id: number) => apiRequest("DELETE", `/api/library/categories/${id}`), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/library/categories"] }); toast({ title: "Category deleted" }); } });
  const createShelf = useMutation({ mutationFn: async (data: { name: string; description?: string }) => apiRequest("POST", "/api/library/shelves", data), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/library/shelves"] }); queryClient.invalidateQueries({ queryKey: ["/api/library/books"] }); setShelfName(""); setShelfDescription(""); setEditingShelf(null); toast({ title: "Bookshelf saved" }); } });
  const updateShelf = useMutation({ mutationFn: async ({ id, data }: { id: number; data: { name: string; description?: string } }) => apiRequest("PUT", `/api/library/shelves/${id}`, data), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/library/shelves"] }); queryClient.invalidateQueries({ queryKey: ["/api/library/books"] }); setShelfName(""); setShelfDescription(""); setEditingShelf(null); toast({ title: "Bookshelf updated" }); } });
  const deleteShelf = useMutation({ mutationFn: async (id: number) => apiRequest("DELETE", `/api/library/shelves/${id}?replacement=${encodeURIComponent("N/A")}`), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/library/shelves"] }); queryClient.invalidateQueries({ queryKey: ["/api/library/books"] }); setEditingShelf(null); setShelfName(""); setShelfDescription(""); toast({ title: "Bookshelf deleted. Books moved to N/A." }); } });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Library Setup</DialogTitle><DialogDescription>Manage Policies, Categories and Bookshelves from one place.</DialogDescription></DialogHeader>
        <Tabs value={activeTab} onValueChange={onTabChange} className="w-full">
          <TabsList className="mb-4 grid h-auto w-full grid-cols-1 gap-2 sm:grid-cols-3"><TabsTrigger value="policies">Manage Policies</TabsTrigger><TabsTrigger value="categories">Manage Categories</TabsTrigger><TabsTrigger value="shelves">Manage Bookshelves</TabsTrigger></TabsList>
          <TabsContent value="policies" className="space-y-4"><form onSubmit={(e)=>{e.preventDefault(); const fd=new FormData(e.currentTarget); savePolicy.mutate({ maxBooksStudent: parseInt(String(fd.get("maxBooksStudent")||1)) || 1, maxBooksTeacher: parseInt(String(fd.get("maxBooksTeacher")||500)) || 500, overdueChargePerDay: String(fd.get("overdueChargePerDay")||"0.50"), defaultBorrowDays: parseInt(String(fd.get("defaultBorrowDays")||1)) || 1 });}} className="space-y-4"><div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="maxBooksStudentParent">Max Books Student can Borrow</Label><Input id="maxBooksStudentParent" name="maxBooksStudent" type="number" min="1" defaultValue={libraryPolicy?.maxBooksStudent ?? 1} /></div><div className="space-y-1.5"><Label htmlFor="maxBooksTeacherParent">Max Books Teacher can Borrow</Label><Input id="maxBooksTeacherParent" name="maxBooksTeacher" type="number" min="1" defaultValue={libraryPolicy?.maxBooksTeacher ?? 500} /></div></div><div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="overdueChargeParent">Overdue Charge Per Day</Label><Input id="overdueChargeParent" name="overdueChargePerDay" type="number" step="0.01" min="0" defaultValue={libraryPolicy?.overdueChargePerDay ?? "0.50"} /></div><div className="space-y-1.5"><Label htmlFor="defaultBorrowDaysParent">Default Number of Borrow Days</Label><Input id="defaultBorrowDaysParent" name="defaultBorrowDays" type="number" min="1" defaultValue={libraryPolicy?.defaultBorrowDays ?? 1} /></div></div><div className="flex justify-end"><Button type="submit">Save Policies</Button></div></form></TabsContent>
          <TabsContent value="categories" className="space-y-4"><form onSubmit={(e)=>{e.preventDefault(); const name=newCatName.trim(); const description=newCatDesc.trim(); if (!name) return; editingCategory ? updateCategory.mutate({ id: editingCategory.id, data: { name, description: description || undefined } }) : createCategory.mutate({ name, description: description || undefined });}} className="space-y-3"><div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]"><div className="space-y-1.5"><Label htmlFor="librarySetupCategoryNameParent">Category name</Label><Input id="librarySetupCategoryNameParent" placeholder="Enter category name" value={newCatName} onChange={(e)=>setNewCatName(e.target.value)} required /></div><div className="space-y-1.5"><Label htmlFor="librarySetupCategoryDescParent">Description (optional)</Label><Input id="librarySetupCategoryDescParent" placeholder="Enter description" value={newCatDesc} onChange={(e)=>setNewCatDesc(e.target.value)} /></div><div className="flex items-end"><Button type="submit" className="w-full md:w-auto">{editingCategory ? "Update" : "Add Category"}</Button></div></div>{editingCategory && <div className="flex justify-end"><Button type="button" variant="outline" onClick={()=>{setEditingCategory(null); setNewCatName(""); setNewCatDesc("");}}>Cancel Edit</Button></div>}</form><div className="space-y-2 max-h-80 overflow-y-auto">{categories.map((cat)=><div key={cat.id} className="flex items-center justify-between gap-2 p-2 border rounded-md"><div><p className="font-medium text-sm">{cat.name}</p>{cat.description && <p className="text-xs text-muted-foreground">{cat.description}</p>}</div><div className="flex items-center gap-1"><Button variant="ghost" size="icon" onClick={()=>{setEditingCategory(cat); setNewCatName(cat.name); setNewCatDesc(cat.description || "");}}><Pencil className="w-4 h-4" /></Button><Button variant="ghost" size="icon" onClick={()=>deleteCategory.mutate(cat.id)}><Trash2 className="w-4 h-4" /></Button></div></div>)}</div></TabsContent>
          <TabsContent value="shelves" className="space-y-4"><form onSubmit={(e)=>{e.preventDefault(); const name=shelfName.trim(); const description=shelfDescription.trim(); if (!name || name === "N/A" || name === "Other") return; editingShelf ? updateShelf.mutate({ id: editingShelf.id, data: { name, description: description || undefined } }) : createShelf.mutate({ name, description: description || undefined });}} className="space-y-3"><div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]"><div className="space-y-1.5"><Label htmlFor="librarySetupShelfNameParent">Bookshelf Name</Label><Input id="librarySetupShelfNameParent" value={shelfName} onChange={(e)=>setShelfName(e.target.value)} placeholder="Enter bookshelf name" /></div><div className="space-y-1.5"><Label htmlFor="librarySetupShelfDescParent">Description (Optional)</Label><Input id="librarySetupShelfDescParent" value={shelfDescription} onChange={(e)=>setShelfDescription(e.target.value)} placeholder="Enter description" /></div><div className="flex items-end"><Button type="submit" className="w-full md:w-auto">{editingShelf ? "Update" : "Add Bookshelf"}</Button></div></div>{editingShelf && <div className="flex justify-end"><Button type="button" variant="outline" onClick={()=>{setEditingShelf(null); setShelfName(""); setShelfDescription("");}}>Cancel Edit</Button></div>}</form><div className="space-y-2 max-h-80 overflow-y-auto">{shelves.map((shelf)=><div key={shelf.id} className="flex items-center justify-between gap-2 p-2 border rounded-md"><div><p className="font-medium text-sm">{shelf.name}</p>{shelf.description && <p className="text-xs text-muted-foreground">{shelf.description}</p>}</div><div className="flex items-center gap-1"><Button type="button" variant="ghost" size="icon" onClick={()=>{setEditingShelf(shelf); setShelfName(shelf.name || ""); setShelfDescription(shelf.description || "");}}><Pencil className="w-4 h-4" /></Button><Button type="button" variant="ghost" size="icon" onClick={()=>deleteShelf.mutate(shelf.id)}><Trash2 className="w-4 h-4" /></Button></div></div>)}</div></TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function SearchablePicker({
  placeholder,
  searchValue,
  onSearchChange,
  options,
  selectedId,
  onSelect,
  emptyText = "No options found",
  dataTestId,
  disabled = false,
}: {
  placeholder: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  options: { id: string; label: string }[];
  selectedId: string;
  onSelect: (id: string, label: string) => void;
  emptyText?: string;
  dataTestId?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Input
        placeholder={placeholder}
        value={searchValue}
        disabled={disabled}
        onFocus={() => !disabled && setOpen(true)}
        onChange={(e) => { onSearchChange(e.target.value); if (!disabled) setOpen(true); }}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        data-testid={dataTestId}
      />
      {open && !disabled && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-56 overflow-y-auto">
          {options.slice(0, 5).length === 0 ? <div className="px-3 py-2 text-sm text-muted-foreground">{emptyText}</div> : options.slice(0, 5).map((option) => (
            <button key={option.id} type="button" className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent ${selectedId === option.id ? "bg-accent" : ""}`} onMouseDown={(e)=>e.preventDefault()} onClick={() => { onSelect(option.id, option.label); setOpen(false); }}>
              <span className="truncate">{option.label}</span>{selectedId === option.id ? <Check className="w-4 h-4 ml-2" /> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CatalogTab({
  books,
  categories,
  subjects,
  classes,
  streams,
  booksLoading,
  onOpenLibrarySetup: _onOpenLibrarySetup,
  onScanPersonCode,
}: {
  books: LibraryBook[];
  categories: LibraryCategory[];
  subjects: Subject[];
  classes: Class[];
  streams: Stream[];
  booksLoading: boolean;
  onOpenLibrarySetup: (tab?: string) => void;
  onScanPersonCode: (code: string) => boolean;
}) {
  const { toast } = useToast();
  const { hasPermission } = useAuth();
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterSubject, setFilterSubject] = useState<string>("all");
  const [isAddBookOpen, setIsAddBookOpen] = useState(false);
  const [editingBook, setEditingBook] = useState<LibraryBook | null>(null);
  const [isCategoriesOpen, setIsCategoriesOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<LibraryCategory | null>(null);
  const [newCatName, setNewCatName] = useState("");
  const [newCatDesc, setNewCatDesc] = useState("");
  const [titleSearch, setTitleSearch] = useState("");
  const [showTitleSuggestions, setShowTitleSuggestions] = useState(false);
  const [autoFillAuthor, setAutoFillAuthor] = useState("");
  const [autoFillIsbn, setAutoFillIsbn] = useState("");
  const [autoFillPublisher, setAutoFillPublisher] = useState("");
  const [autoFillEdition, setAutoFillEdition] = useState("");
  const [autoFillYear, setAutoFillYear] = useState("");
  const [autoFillCategory, setAutoFillCategory] = useState("");
  const [autoFillSubject, setAutoFillSubject] = useState("");
  const [autoFillDescription, setAutoFillDescription] = useState("");
  const [autoFillStreamIds, setAutoFillStreamIds] = useState<string[]>([]);
  const [selectedShelf, setSelectedShelf] = useState("N/A");
  const [customShelfName, setCustomShelfName] = useState("");
  const [isShelfManagerOpen, setIsShelfManagerOpen] = useState(false);
  const [editingShelf, setEditingShelf] = useState<LibraryShelf | null>(null);
  const [shelfName, setShelfName] = useState("");
  const [shelfDescription, setShelfDescription] = useState("");
  const [addCopyBookId, setAddCopyBookId] = useState<number | null>(null);
  const [addCopyQrOpen, setAddCopyQrOpen] = useState(false);
  const [addCopyQrCode, setAddCopyQrCode] = useState("");
  const [addCopyCondition, setAddCopyCondition] = useState("Good");
  const [viewCopiesBookId, setViewCopiesBookId] = useState<number | null>(null);
  const [isLibrarySetupOpen, setIsLibrarySetupOpen] = useState(false);
  const [librarySetupTab, setLibrarySetupTab] = useState("policies");
  const [scanLookupOpen, setScanLookupOpen] = useState(false);
  const [selectedCopy, setSelectedCopy] = useState<LibraryBookCopy | null>(null);
  const [isCopyEditing, setIsCopyEditing] = useState(false);
  const [copyEditBanner, setCopyEditBanner] = useState(false);
  const [copyAttachmentFiles, setCopyAttachmentFiles] = useState<File[]>([]);
  const [copyDraft, setCopyDraft] = useState({ qrCode: "", status: "available", condition: "Good", notes: "" });
  const [attachmentsCopy, setAttachmentsCopy] = useState<LibraryBookCopy | null>(null);
  const [selectedAttachment, setSelectedAttachment] = useState<string | null>(null);

  const { data: bookCopies = [], isLoading: copiesLoading } = useQuery<LibraryBookCopy[]>({
    queryKey: ["/api/library/books", viewCopiesBookId, "copies"],
    queryFn: async () => {
      if (!viewCopiesBookId) return [];
      const res = await schoolFetch(`/api/library/books/${viewCopiesBookId}/copies`);
      if (!res.ok) throw new Error("Failed to fetch copies");
      return res.json();
    },
    enabled: !!viewCopiesBookId,
  });

  const { data: shelves = [] } = useQuery<LibraryShelf[]>({
    queryKey: ["/api/library/shelves"],
    queryFn: async () => {
      const res = await schoolFetch("/api/library/shelves");
      if (!res.ok) throw new Error("Failed to fetch shelves");
      const payload = await res.json();
      return Array.isArray(payload) ? payload : [];
    },
  });

  useEffect(() => {
    const handler = (event: Event) => {
      const tab = (event as CustomEvent<{ tab?: string }>).detail?.tab || "policies";
      setLibrarySetupTab(tab);
      setIsLibrarySetupOpen(true);
    };
    window.addEventListener("library-open-setup", handler as EventListener);
    return () => window.removeEventListener("library-open-setup", handler as EventListener);
  }, []);

  const openCopyDetails = (copy: LibraryBookCopy, options?: { startEditing?: boolean; showRecoveryBanner?: boolean }) => {
    setSelectedCopy(copy);
    setCopyDraft({
      qrCode: copy.qrCode || "",
      status: (options?.showRecoveryBanner ? "available" : (copy.status || "available")) as string,
      condition: (options?.showRecoveryBanner && copy.condition === "Lost" ? "Good" : (copy.condition || "Good")) as string,
      notes: copy.notes || "",
    });
    setIsCopyEditing(!!options?.startEditing);
    setCopyEditBanner(!!options?.showRecoveryBanner);
    setCopyAttachmentFiles([]);
  };

  const addCopy = useMutation({
    mutationFn: async ({ bookId, qrCode, condition }: { bookId: number; qrCode: string; condition: string }) =>
      apiRequest("POST", `/api/library/books/${bookId}/copies`, { qrCode, condition }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/library/books"] });
      if (viewCopiesBookId) queryClient.invalidateQueries({ queryKey: ["/api/library/books", viewCopiesBookId, "copies"] });
      setAddCopyBookId(null);
      setAddCopyQrCode("");
      setAddCopyCondition("Good");
      toast({ title: "Book copy added successfully" });
    },
    onError: (error: Error) => toast({ title: error.message || "Failed to add copy", variant: "destructive" }),
  });

  const deleteCopy = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/library/copies/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/library/books"] });
      if (viewCopiesBookId) queryClient.invalidateQueries({ queryKey: ["/api/library/books", viewCopiesBookId, "copies"] });
      toast({ title: "Copy removed" });
    },
    onError: () => toast({ title: "Failed to remove copy", variant: "destructive" }),
  });

  const updateCopy = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Record<string, unknown> }) => {
      const res = await apiRequest("PUT", `/api/library/copies/${id}`, data);
      return res.json();
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["/api/library/books"] });
      if (viewCopiesBookId) queryClient.invalidateQueries({ queryKey: ["/api/library/books", viewCopiesBookId, "copies"] });
      setSelectedCopy(updated);
      setAttachmentsCopy((current) => (current?.id === updated.id ? updated : current));
      setIsCopyEditing(false);
      setCopyAttachmentFiles([]);
      setCopyEditBanner(false);
      setCopyDraft({
        qrCode: updated.qrCode || "",
        status: updated.status || "available",
        condition: updated.condition || "Good",
        notes: updated.notes || "",
      });
      toast({ title: "Copy updated successfully" });
    },
    onError: (error: Error) => toast({ title: error.message || "Failed to update copy", variant: "destructive" }),
  });

  const uploadCopyAttachment = useMutation({
    mutationFn: async ({ id, file }: { id: number; file: File }) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await schoolFetch(`/api/library/copies/${id}/attachments`, { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Failed to upload attachment");
      }
      return res.json();
    },
    onSuccess: (result) => {
      if (result?.copy) {
        setSelectedCopy(result.copy);
        setAttachmentsCopy(result.copy);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/library/books"] });
      if (viewCopiesBookId) queryClient.invalidateQueries({ queryKey: ["/api/library/books", viewCopiesBookId, "copies"] });
    },
  });

  const deleteCopyAttachment = useMutation({
    mutationFn: async ({ id, attachmentUrl }: { id: number; attachmentUrl: string }) => {
      const res = await apiRequest("DELETE", `/api/library/copies/${id}/attachments`, { attachmentUrl });
      return res.json();
    },
    onSuccess: (updated) => {
      setSelectedCopy(updated);
      setAttachmentsCopy(updated);
      queryClient.invalidateQueries({ queryKey: ["/api/library/books"] });
      if (viewCopiesBookId) queryClient.invalidateQueries({ queryKey: ["/api/library/books", viewCopiesBookId, "copies"] });
      toast({ title: "Attachment removed" });
    },
    onError: (error: Error) => toast({ title: error.message || "Failed to remove attachment", variant: "destructive" }),
  });

  const lookupQrCatalog = useMutation({
    mutationFn: async (qrCode: string) => {
      const res = await schoolFetch(`/api/library/copies/qr/${encodeURIComponent(qrCode)}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "QR code not found");
      }
      return res.json();
    },
    onSuccess: (data) => {
      if (data?.book?.id) setViewCopiesBookId(data.book.id);
      if (data?.copy) {
        openCopyDetails(data.copy);
      }
    },
    onError: (error: Error) => toast({ title: error.message, variant: "destructive" }),
  });

  const createBook = useMutation({
    mutationFn: async (data: Partial<LibraryBook>) => {
      const res = await apiRequest("POST", "/api/library/books", data);
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/library/books"] });
      setIsAddBookOpen(false);
      resetAutoFill();
      toast({ title: "Book added successfully" });
    },
    onError: (error: Error) => toast({ title: error.message || "Failed to add book", variant: "destructive" }),
  });

  const updateBook = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<LibraryBook> }) =>
      apiRequest("PUT", `/api/library/books/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/library/books"] });
      setEditingBook(null);
      toast({ title: "Book updated successfully" });
    },
    onError: () => toast({ title: "Failed to update book", variant: "destructive" }),
  });

  const deleteBook = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/library/books/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/library/books"] });
      toast({ title: "Book deleted" });
    },
    onError: () => toast({ title: "Failed to delete book", variant: "destructive" }),
  });

  const [isPolicyOpen, setIsPolicyOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<{ imported: number; updated: number; skipped: number; total: number } | null>(null);

  const { data: libraryPolicy } = useQuery<LibraryPolicy>({
    queryKey: ["/api/library/policy"],
  });

  const savePolicy = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await schoolFetch("/api/library/policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to save policy");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/library/policy"] });
      setIsPolicyOpen(false);
      toast({ title: "Library policy saved" });
    },
    onError: () => toast({ title: "Failed to save policy", variant: "destructive" }),
  });

  const importBooks = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await schoolFetch("/api/library/books/import", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) throw new Error("Failed to import books");
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/library/books"] });
      setImportResult(result);
      setImportFile(null);
      toast({ title: `Imported ${result.imported} books` });
    },
    onError: () => toast({ title: "Failed to import books", variant: "destructive" }),
  });

  const createCategory = useMutation({
    mutationFn: async (data: { name: string; description?: string }) =>
      apiRequest("POST", "/api/library/categories", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/library/categories"] });
      setNewCatName("");
      setNewCatDesc("");
      toast({ title: "Category added" });
    },
    onError: () => toast({ title: "Failed to add category", variant: "destructive" }),
  });

  const updateCategory = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: { name: string; description?: string } }) =>
      apiRequest("PUT", `/api/library/categories/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/library/categories"] });
      setEditingCategory(null);
      setNewCatName("");
      setNewCatDesc("");
      toast({ title: "Category updated" });
    },
    onError: () => toast({ title: "Failed to update category", variant: "destructive" }),
  });

  const deleteCategory = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/library/categories/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/library/categories"] });
      toast({ title: "Category deleted" });
    },
    onError: () => toast({ title: "Failed to delete category", variant: "destructive" }),
  });

  const createShelf = useMutation({
    mutationFn: async (data: { name: string; description?: string }) => apiRequest("POST", "/api/library/shelves", data),
    onSuccess: async (res) => {
      queryClient.invalidateQueries({ queryKey: ["/api/library/shelves"] });
      const created = await res.json();
      setSelectedShelf(created.name);
      setCustomShelfName("");
      setShelfName("");
      setShelfDescription("");
      setEditingShelf(null);
      toast({ title: "Shelf saved" });
    },
    onError: (error: Error) => toast({ title: error.message || "Failed to save shelf", variant: "destructive" }),
  });

  const updateShelf = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: { name: string; description?: string } }) => apiRequest("PUT", `/api/library/shelves/${id}`, data),
    onSuccess: async (res) => {
      queryClient.invalidateQueries({ queryKey: ["/api/library/shelves"] });
      queryClient.invalidateQueries({ queryKey: ["/api/library/books"] });
      const updated = await res.json();
      setSelectedShelf(updated.name);
      setCustomShelfName("");
      setShelfName("");
      setShelfDescription("");
      setEditingShelf(null);
      toast({ title: "Shelf updated" });
    },
    onError: (error: Error) => toast({ title: error.message || "Failed to update shelf", variant: "destructive" }),
  });

  const deleteShelf = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/library/shelves/${id}?replacement=${encodeURIComponent("N/A")}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/library/shelves"] });
      queryClient.invalidateQueries({ queryKey: ["/api/library/books"] });
      setSelectedShelf("N/A");
      setEditingShelf(null);
      setShelfName("");
      setShelfDescription("");
      toast({ title: "Shelf deleted. Books moved to N/A." });
    },
    onError: (error: Error) => toast({ title: error.message || "Failed to delete shelf", variant: "destructive" }),
  });

  const filteredBooks = useMemo(() => {
    return books.filter((b) => {
      const matchesSearch =
        b.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (b.author?.toLowerCase().includes(searchTerm.toLowerCase()) ?? false) ||
        (b.isbn?.toLowerCase().includes(searchTerm.toLowerCase()) ?? false);
      const matchesCategory = filterCategory === "all" || b.categoryId?.toString() === filterCategory;
      const matchesSubject = filterSubject === "all" || b.subjectId?.toString() === filterSubject;
      return matchesSearch && matchesCategory && matchesSubject;
    });
  }, [books, searchTerm, filterCategory, filterSubject]);

  const getClassNameForBook = (classId: number | null | undefined) => {
    if (!classId) return "";
    const cls = classes.find((c) => c.id === classId);
    return cls?.className || "";
  };

  const uniqueTitles = useMemo(() => {
    const titleMap = new Map<string, LibraryBook>();
    books.forEach((b) => {
      const key = b.title.toLowerCase().trim();
      if (!titleMap.has(key)) titleMap.set(key, b);
    });
    return Array.from(titleMap.values());
  }, [books]);

  const titleSuggestions = useMemo(() => {
    if (!titleSearch) return [];
    const term = titleSearch.toLowerCase();
    return uniqueTitles.filter((b) => b.title.toLowerCase().includes(term)).slice(0, 8);
  }, [titleSearch, uniqueTitles]);

  const getCategoryName = (id: number | null | undefined) => {
    if (!id) return "-";
    return categories.find((c) => c.id === id)?.name || "-";
  };

  const getSubjectName = (id: number | null | undefined) => {
    if (!id) return "-";
    return (Array.isArray(subjects) ? subjects : []).find((s) => s.id === id)?.name || "-";
  };

  const canDeleteLibraryRecords = hasPermission("library.catalogue.delete");

  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [autoFillStream, setAutoFillStream] = useState("");
  const [autoFillShelf, setAutoFillShelf] = useState("");
  const [autoFillPubDate, setAutoFillPubDate] = useState("");


  const handleCoverSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setCoverFile(file);
      const reader = new FileReader();
      reader.onload = () => setCoverPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const shelfOptions = useMemo(() => {
    const customNames = shelves
      .map((s) => s.name?.trim())
      .filter((name): name is string => !!name && name.length > 0)
      .filter((name) => name !== "N/A" && name !== "Other");

    return ["N/A", ...customNames, "Other"];
  }, [shelves]);

  const resetAutoFill = () => {
    setTitleSearch("");
    setShowTitleSuggestions(false);
    setAutoFillAuthor("");
    setAutoFillIsbn("");
    setAutoFillPublisher("");
    setAutoFillEdition("");
    setAutoFillYear("");
    setAutoFillCategory("");
    setAutoFillSubject("");
    setAutoFillDescription("");
    setAutoFillStream("");
    setAutoFillStreamIds([]);
    setSelectedShelf("N/A");
    setCustomShelfName("");
    setShelfName("");
    setShelfDescription("");
    setEditingShelf(null);
    setCoverFile(null);
    setCoverPreview(null);
    setAutoFillPubDate("");
    setAutoFillShelf("");
  };

  const handleTitleSuggestionSelect = (suggestion: LibraryBook) => {
    setTitleSearch(suggestion.title || "");
    setAutoFillAuthor(suggestion.author || "");
    setAutoFillIsbn(suggestion.isbn || "");
    setAutoFillPublisher(suggestion.publisher || "");
    setAutoFillEdition("");
    setAutoFillYear(suggestion.publishYear?.toString() || "");
    setAutoFillCategory(suggestion.categoryId?.toString() || "");
    setAutoFillSubject(suggestion.subjectId?.toString() || "");
    setAutoFillDescription(suggestion.description || "");
    setAutoFillPubDate(
      suggestion.publicationDate
        ? new Date(suggestion.publicationDate).toISOString().split("T")[0]
        : ""
    );

    const nextStreamIds =
      Array.isArray((suggestion as any).streamIds) && (suggestion as any).streamIds.length > 0
        ? (suggestion as any).streamIds.map((id: number) => String(id))
        : suggestion.streamId
          ? [String(suggestion.streamId)]
          : [];

    setAutoFillStreamIds(nextStreamIds);
    setAutoFillStream(nextStreamIds[0] || "");
    setSelectedShelf(suggestion.shelfLocation || "N/A");
    setAutoFillShelf(suggestion.shelfLocation || "N/A");
    setShowTitleSuggestions(false);
  };

  const toggleStreamSelection = (streamId: string) => {
    setAutoFillStreamIds((prev) => {
      const exists = prev.includes(streamId);
      const next = exists ? prev.filter((id) => id !== streamId) : [...prev, streamId];
      setAutoFillStream(next[0] || "");
      return next;
    });
  };

  const openShelfEditor = (shelf?: LibraryShelf | null) => {
    if (shelf) {
      setEditingShelf(shelf);
      setShelfName(shelf.name || "");
      setShelfDescription(shelf.description || "");
    } else {
      setEditingShelf(null);
      setShelfName("");
      setShelfDescription("");
    }
    setIsShelfManagerOpen(true);
  };

  const handleQuickShelfCreate = () => {
    const trimmed = customShelfName.trim();
    if (!trimmed) {
      toast({ title: "Enter a shelf name", variant: "destructive" });
      return;
    }

    const existing = shelves.find(
      (s) => s.name.trim().toLowerCase() === trimmed.toLowerCase()
    );

    if (existing) {
      setSelectedShelf(existing.name);
      setAutoFillShelf(existing.name);
      setCustomShelfName("");
      toast({ title: "Shelf already exists. Selected it for you." });
      return;
    }

    createShelf.mutate({
      name: trimmed,
      description: "",
    });
  };

  const handleCategorySubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = newCatName.trim();
    const description = newCatDesc.trim();

    if (!name) {
      toast({ title: "Category name is required", variant: "destructive" });
      return;
    }

    if (editingCategory) {
      updateCategory.mutate({
        id: editingCategory.id,
        data: {
          name,
          description: description || undefined,
        },
      });
    } else {
      createCategory.mutate({
        name,
        description: description || undefined,
      });
    }
  };

  const handleShelfSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = shelfName.trim();
    const description = shelfDescription.trim();

    if (!name) {
      toast({ title: "Shelf name is required", variant: "destructive" });
      return;
    }

    if (name === "N/A" || name === "Other") {
      toast({ title: "That shelf name is reserved", variant: "destructive" });
      return;
    }

    if (editingShelf) {
      updateShelf.mutate({
        id: editingShelf.id,
        data: {
          name,
          description: description || undefined,
        },
      });
    } else {
      createShelf.mutate({
        name,
        description: description || undefined,
      });
    }
  };

  const bookFormDialog = (open: boolean, onOpenChange: (v: boolean) => void, book?: LibraryBook | null) => {
    const isEditing = !!book;
    const editCoverUrl = book?.coverImage || null;

    const handleBookSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();

      const form = e.currentTarget;
      const fd = new FormData(form);

      const finalTitle = String(fd.get("title") || titleSearch || "").trim();
      const finalShelf =
        (selectedShelf === "Other" ? customShelfName : selectedShelf || "N/A").trim() || "N/A";

      if (!finalTitle) {
        toast({ title: "Book title is required", variant: "destructive" });
        return;
      }

      const rawSubjectId = String(fd.get("subjectId") || "").trim();
      if (!rawSubjectId) {
        toast({ title: "Please select a subject", variant: "destructive" });
        return;
      }

      if (selectedShelf === "Other" && !customShelfName.trim()) {
        toast({ title: "Enter the new shelf name", variant: "destructive" });
        return;
      }

      let coverImageUrl: string | undefined = book?.coverImage || undefined;

      if (coverFile) {
        const imageFd = new FormData();
        imageFd.append("file", coverFile);

        const uploadRes = await schoolFetch("/api/library/books/cover-upload", {
          method: "POST",
          body: imageFd,
        });

        if (!uploadRes.ok) {
          toast({ title: "Failed to upload cover image", variant: "destructive" });
          return;
        }

        const uploadJson = await uploadRes.json();
        coverImageUrl = uploadJson?.url;
      }

      const streamIds = autoFillStreamIds
        .map((value) => parseInt(String(value), 10))
        .filter((value) => !Number.isNaN(value));

      const payload: Partial<LibraryBook> & { streamIds?: number[] } = {
        title: finalTitle,
        isbn: String(fd.get("isbn") || "").trim() || undefined,
        author: String(fd.get("author") || "").trim() || undefined,
        publisher: String(fd.get("publisher") || "").trim() || undefined,
        publicationDate: String(fd.get("publicationDate") || "").trim() || undefined,
        subjectId: parseInt(rawSubjectId, 10),
        description: String(fd.get("description") || "").trim() || undefined,
        publishYear: fd.get("publishYear")
          ? parseInt(String(fd.get("publishYear")), 10)
          : undefined,
        categoryId: fd.get("categoryId")
          ? parseInt(String(fd.get("categoryId")), 10)
          : undefined,
        classId: fd.get("classId")
          ? parseInt(String(fd.get("classId")), 10)
          : undefined,
        totalCopies: fd.get("totalCopies")
          ? parseInt(String(fd.get("totalCopies")), 10)
          : 1,
        shelfLocation: finalShelf,
        coverImage: coverImageUrl,
        streamId: streamIds.length > 0 ? streamIds[0] : undefined,
        streamIds,
      };

      if (book?.id) {
        updateBook.mutate({ id: book.id, data: payload });
      } else {
        createBook.mutate({
          ...payload,
          availableCopies: payload.totalCopies ?? 1,
          damagedCopies: 0,
          lostStolenCopies: 0,
        });
      }
    };

    return (
      <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) resetAutoFill(); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">{isEditing ? "Edit Book" : "BOOK"}</DialogTitle>
            <DialogDescription>{isEditing ? "Update book details" : "Add a new book to the catalog. Type a title to see existing books for auto-fill."}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleBookSubmit} className="space-y-4">
            <div className="space-y-1.5 relative">
              <Label htmlFor="title" className="text-sm font-semibold">
                <span className="text-red-500">*</span> Book Title
              </Label>
              {isEditing ? (
                <Input id="title" name="title" required defaultValue={book?.title || ""} placeholder="Title" data-testid="input-book-title" />
              ) : (
                <Input
                  id="title"
                  name="title"
                  required
                  value={titleSearch}
                  placeholder="Title"
                  onChange={(e) => {
                    setTitleSearch(e.target.value);
                    setShowTitleSuggestions(e.target.value.length > 0);
                  }}
                  onFocus={() => titleSearch.length > 0 && setShowTitleSuggestions(true)}
                  autoComplete="off"
                  data-testid="input-book-title"
                />
              )}
              {!isEditing && showTitleSuggestions && titleSuggestions.length > 0 && (
                <div className="absolute z-50 w-full border rounded-md bg-popover shadow-md max-h-48 overflow-y-auto" style={{ top: "100%" }}>
                  {titleSuggestions.map((suggestion) => (
                    <button
                      key={suggestion.id}
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover-elevate"
                      onClick={() => handleTitleSuggestionSelect(suggestion)}
                      data-testid={`suggestion-title-${suggestion.id}`}
                    >
                      <span className="font-medium">{suggestion.title}</span>
                      <span className="text-muted-foreground ml-2">by {suggestion.author || "Unknown"}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="isbn" className="text-sm font-semibold">
                  <span className="text-red-500">*</span> Book ISBN
                </Label>
                {isEditing ? (
                  <Input id="isbn" name="isbn" placeholder="Enter isbn" defaultValue={book?.isbn || ""} data-testid="input-book-isbn" />
                ) : (
                  <Input id="isbn" name="isbn" placeholder="Enter isbn" value={autoFillIsbn} onChange={(e) => setAutoFillIsbn(e.target.value)} data-testid="input-book-isbn" />
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="author" className="text-sm font-semibold">
                  <span className="text-red-500">*</span> Author(s)
                </Label>
                {isEditing ? (
                  <Input id="author" name="author" placeholder="Enter author(s)" defaultValue={book?.author || ""} data-testid="input-book-author" />
                ) : (
                  <Input id="author" name="author" placeholder="Enter author(s)" value={autoFillAuthor} onChange={(e) => setAutoFillAuthor(e.target.value)} data-testid="input-book-author" />
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="publisher" className="text-sm font-semibold">
                  <span className="text-red-500">*</span> Publisher
                </Label>
                {isEditing ? (
                  <Input id="publisher" name="publisher" placeholder="Enter publisher" defaultValue={book?.publisher || ""} data-testid="input-book-publisher" />
                ) : (
                  <Input id="publisher" name="publisher" placeholder="Enter publisher" value={autoFillPublisher} onChange={(e) => setAutoFillPublisher(e.target.value)} data-testid="input-book-publisher" />
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="publicationDate" className="text-sm font-semibold">
                  <span className="text-red-500">*</span> Publication Date
                </Label>
                {isEditing ? (
                  <Input id="publicationDate" name="publicationDate" type="date" placeholder="Enter publication date" defaultValue={book?.publicationDate || ""} data-testid="input-book-pubdate" />
                ) : (
                  <Input id="publicationDate" name="publicationDate" type="date" placeholder="Enter publication date" value={autoFillPubDate} onChange={(e) => setAutoFillPubDate(e.target.value)} data-testid="input-book-pubdate" />
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold">
                  <span className="text-red-500">*</span> Subject
                </Label>
                {isEditing ? (
                  <Select name="subjectId" defaultValue={book?.subjectId?.toString() || ""}>
                    <SelectTrigger data-testid="select-book-subject">
                      <SelectValue placeholder="Select Subject" />
                    </SelectTrigger>
                    <SelectContent className="max-h-48 overflow-y-auto">
                      {(Array.isArray(subjects) ? subjects : []).map((s) => (
                        <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Select name="subjectId" value={autoFillSubject} onValueChange={setAutoFillSubject}>
                    <SelectTrigger data-testid="select-book-subject">
                      <SelectValue placeholder="Select Subject" />
                    </SelectTrigger>
                    <SelectContent className="max-h-48 overflow-y-auto">
                      {(Array.isArray(subjects) ? subjects : []).map((s) => (
                        <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold">Category</Label>
                {isEditing ? (
                  <Select name="categoryId" defaultValue={book?.categoryId?.toString() || ""}>
                    <SelectTrigger data-testid="select-book-category">
                      <SelectValue placeholder="Select Category" />
                    </SelectTrigger>
                    <SelectContent className="max-h-48 overflow-y-auto">
                      {categories.map((category) => (
                        <SelectItem key={category.id} value={category.id.toString()}>{category.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Select name="categoryId" value={autoFillCategory} onValueChange={setAutoFillCategory}>
                    <SelectTrigger data-testid="select-book-category">
                      <SelectValue placeholder="Select Category" />
                    </SelectTrigger>
                    <SelectContent className="max-h-48 overflow-y-auto">
                      {categories.map((category) => (
                        <SelectItem key={category.id} value={category.id.toString()}>{category.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold">Bookshelf</Label>
                <div className="flex gap-2">
                  <Select value={selectedShelf} onValueChange={(value) => { setSelectedShelf(value); setAutoFillShelf(value); if (value !== "Other") setCustomShelfName(""); }}>
                    <SelectTrigger data-testid="select-book-shelf">
                      <SelectValue placeholder="Bookshelf" />
                    </SelectTrigger>
                    <SelectContent className="max-h-60">
                      {shelfOptions.map((shelfNameOption) => (
                        <SelectItem key={shelfNameOption} value={shelfNameOption}>{shelfNameOption}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {selectedShelf === "Other" && (
                  <div className="flex gap-2">
                    <Input
                      value={customShelfName}
                      onChange={(e) => setCustomShelfName(e.target.value)}
                      placeholder="Enter new shelf name"
                      data-testid="input-custom-shelf"
                    />
                    <Button type="button" variant="secondary" onClick={handleQuickShelfCreate} data-testid="button-add-custom-shelf">
                      Add Bookshelf
                    </Button>
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold">
                  <span className="text-red-500">*</span> Stream(s) Allocation
                </Label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="outline" className="w-full justify-between" data-testid="select-book-streams">
                      <span className="truncate">
                        {autoFillStreamIds.length > 0
                          ? autoFillStreamIds
                              .map((id) => streams.find((stream) => stream.id.toString() === id)?.name || id)
                              .join(", ")
                          : "Select stream(s)"}
                      </span>
                      <MoreHorizontal className="w-4 h-4 ml-2 shrink-0" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)] max-h-60 overflow-y-auto">
                    {streams.length === 0 ? (
                      <div className="px-2 py-3 text-sm text-muted-foreground">No streams configured for this school setup.</div>
                    ) : (
                      streams.map((stream) => {
                        const selected = autoFillStreamIds.includes(stream.id.toString());
                        return (
                          <DropdownMenuItem
                            key={stream.id}
                            onSelect={(e) => {
                              e.preventDefault();
                              toggleStreamSelection(stream.id.toString());
                            }}
                            className={selected ? "bg-accent text-accent-foreground" : ""}
                            data-testid={`option-book-stream-${stream.id}`}
                          >
                            <Check className={`w-4 h-4 mr-2 ${selected ? "opacity-100" : "opacity-0"}`} />
                            <span>{stream.name}</span>
                          </DropdownMenuItem>
                        );
                      })
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="description" className="text-sm font-semibold">Description(Optional)</Label>
              {isEditing ? (
                <Input id="description" name="description" placeholder="Enter book description" defaultValue={book?.description || ""} data-testid="input-book-description" />
              ) : (
                <Input id="description" name="description" placeholder="Enter book description" value={autoFillDescription} onChange={(e) => setAutoFillDescription(e.target.value)} data-testid="input-book-description" />
              )}
            </div>

            <input type="hidden" name="publishYear" value={isEditing ? (book?.publishYear || "") : autoFillYear} />
            <input type="hidden" name="classId" value={book?.classId?.toString() || ""} />
            <input type="hidden" name="totalCopies" value={book?.totalCopies || 1} />
            <input type="hidden" name="shelfLocation" value={(selectedShelf === "Other" ? customShelfName : selectedShelf) || "N/A"} />
            {autoFillStreamIds.map((streamId) => (
              <input key={streamId} type="hidden" name="streamIds" value={streamId} />
            ))}

            <div className="space-y-2">
              <Label className="text-sm font-semibold">Book Cover</Label>
              <label
                htmlFor="cover-upload-gallery"
                className="flex flex-col items-center justify-center border-2 border-dashed rounded-md p-5 cursor-pointer hover-elevate transition-colors"
                data-testid="upload-cover-image-gallery"
              >
                {coverPreview || editCoverUrl ? (
                  <img
                    src={coverPreview || editCoverUrl || ""}
                    alt="Cover preview"
                    className="max-h-32 object-contain rounded-md mb-2"
                  />
                ) : (
                  <ImagePlus className="w-8 h-8 mb-2 text-muted-foreground" />
                )}
                <span className="text-sm font-medium">Upload Book Cover</span>
                <input
                  id="cover-upload-gallery"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleCoverSelect}
                />
              </label>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => { onOpenChange(false); resetAutoFill(); }} data-testid="button-cancel-book">
                Cancel
              </Button>
              <Button type="submit" disabled={createBook.isPending || updateBook.isPending} data-testid="button-submit-book">
                {createBook.isPending || updateBook.isPending ? "Saving..." : "Submit"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    );
  };  

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-3 flex-1 min-w-0 flex-wrap">
          <div className="relative w-full basis-full md:basis-auto md:flex-1 md:min-w-[260px] md:max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search books..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
              data-testid="input-search-books"
            />
          </div>
          <Select value={filterCategory} onValueChange={setFilterCategory}>
            <SelectTrigger className="w-full sm:w-[180px]" data-testid="select-filter-category">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterSubject} onValueChange={setFilterSubject}>
            <SelectTrigger className="w-full sm:w-[180px]" data-testid="select-catalog-subject-filter">
              <SelectValue placeholder="Subject" />
            </SelectTrigger>
            <SelectContent className="max-h-48 overflow-y-auto">
              <SelectItem value="all">All Subjects</SelectItem>
              {(Array.isArray(subjects) ? subjects : []).map((s) => (
                <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" onClick={() => {
            const headers = ["Title", "Author", "ISBN", "Publisher", "Category", "Subject", "Class", "Total Copies", "Available", "Shelf Location"];
            const rows = filteredBooks.map((b) => [
              b.title,
              b.author || "",
              b.isbn || "",
              b.publisher || "",
              getCategoryName(b.categoryId),
              getSubjectName(b.subjectId),
              getClassNameForBook(b.classId),
              b.totalCopies?.toString() || "0",
              b.availableCopies?.toString() || "0",
              b.shelfLocation || "",
            ]);
            const csv = [headers, ...rows].map(r => r.map(c => `"${(c || "").replace(/"/g, '""')}"`).join(",")).join("\n");
            const blob = new Blob([csv], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            const subjectLabel = filterSubject !== "all" ? `_${subjects?.find(s => s.id.toString() === filterSubject)?.name?.replace(/\s+/g, "_") || ""}` : "";
            const categoryLabel = filterCategory !== "all" ? `_${categories?.find(c => c.id.toString() === filterCategory)?.name?.replace(/\s+/g, "_") || ""}` : "";
            const searchLabel = searchTerm.trim() ? `_search_${searchTerm.trim().replace(/\s+/g, "_")}` : "";
            a.download = `Library_Inventory${categoryLabel}${subjectLabel}${searchLabel}_${new Date().toISOString().split("T")[0]}.csv`;
            a.click();
            URL.revokeObjectURL(url);
          }} data-testid="button-download-inventory">
            <Download className="w-4 h-4 mr-2" /> Download
          </Button>
          <Button variant="outline" onClick={() => { setIsImportOpen(true); setImportResult(null); }} data-testid="button-import-books">
            <FileSpreadsheet className="w-4 h-4 mr-2" /> Upload
          </Button>
          <Button variant="outline" onClick={() => { setLibrarySetupTab("policies"); setIsLibrarySetupOpen(true); }} data-testid="button-library-setup">
            <Settings className="w-4 h-4 mr-2" /> Library Setup
          </Button>
          <Button variant="outline" onClick={() => setScanLookupOpen(true)} data-testid="button-scan-qr-catalog">
            <Camera className="w-4 h-4 mr-2" /> Scan QR Code
          </Button>
          <Button onClick={() => { resetAutoFill(); setSelectedShelf("N/A"); setAutoFillStreamIds([]); setIsAddBookOpen(true); }} data-testid="button-add-book">
            <Plus className="w-4 h-4 mr-2" /> Add Book
          </Button>
        </div>
      </div>

      {bookFormDialog(isAddBookOpen, setIsAddBookOpen)}
      {bookFormDialog(editingBook !== null, (v) => !v && setEditingBook(null), editingBook)}

      <Dialog open={isLibrarySetupOpen} onOpenChange={setIsLibrarySetupOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Library Setup</DialogTitle>
            <DialogDescription>Manage Policies, Categories and Bookshelves from one place.</DialogDescription>
          </DialogHeader>
          <Tabs value={librarySetupTab} onValueChange={setLibrarySetupTab} className="w-full">
            <TabsList className="mb-4 grid h-auto w-full grid-cols-1 gap-2 sm:grid-cols-3">
              <TabsTrigger value="policies">Manage Policies</TabsTrigger>
              <TabsTrigger value="categories">Manage Categories</TabsTrigger>
              <TabsTrigger value="shelves">Manage Bookshelves</TabsTrigger>
            </TabsList>
            <TabsContent value="policies" className="space-y-4">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  savePolicy.mutate({
                    maxBooksStudent: parseInt(fd.get("maxBooksStudent") as string) || 1,
                    maxBooksTeacher: parseInt(fd.get("maxBooksTeacher") as string) || 500,
                    overdueChargePerDay: fd.get("overdueChargePerDay") as string || "0.50",
                    defaultBorrowDays: parseInt(fd.get("defaultBorrowDays") as string) || 1,
                  });
                }}
                className="space-y-4"
              >
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5"><Label htmlFor="maxBooksStudent">Max Books Student can Borrow</Label><Input id="maxBooksStudent" name="maxBooksStudent" type="number" min="1" defaultValue={libraryPolicy?.maxBooksStudent ?? 1} /></div>
                  <div className="space-y-1.5"><Label htmlFor="maxBooksTeacher">Max Books Teacher can Borrow</Label><Input id="maxBooksTeacher" name="maxBooksTeacher" type="number" min="1" defaultValue={libraryPolicy?.maxBooksTeacher ?? 500} /></div>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="overdueChargePerDay">Overdue Charge Per Day</Label><Input id="overdueChargePerDay" name="overdueChargePerDay" type="number" step="0.01" min="0" defaultValue={libraryPolicy?.overdueChargePerDay ?? "0.50"} /></div><div className="space-y-1.5"><Label htmlFor="defaultBorrowDays">Default Number of Borrow Days</Label><Input id="defaultBorrowDays" name="defaultBorrowDays" type="number" min="1" defaultValue={libraryPolicy?.defaultBorrowDays ?? 1} /></div></div>
                <div className="flex justify-end"><Button type="submit" disabled={savePolicy.isPending}>{savePolicy.isPending ? "Saving..." : "Save Policies"}</Button></div>
              </form>
            </TabsContent>
            <TabsContent value="categories" className="space-y-4">
              <form onSubmit={handleCategorySubmit} className="space-y-3">
                <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                  <div className="space-y-1.5">
                    <Label htmlFor="library-setup-category-name">Category name</Label>
                    <Input id="library-setup-category-name" placeholder="Enter category name" value={newCatName} onChange={(e) => setNewCatName(e.target.value)} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="library-setup-category-description">Description (optional)</Label>
                    <Input id="library-setup-category-description" placeholder="Enter description" value={newCatDesc} onChange={(e) => setNewCatDesc(e.target.value)} />
                  </div>
                  <div className="flex items-end">
                    <Button type="submit" className="w-full md:w-auto" disabled={createCategory.isPending || updateCategory.isPending}>{editingCategory ? "Update" : "Add Category"}</Button>
                  </div>
                </div>
                {editingCategory && (
                  <div className="flex justify-end">
                    <Button type="button" variant="outline" onClick={() => { setEditingCategory(null); setNewCatName(""); setNewCatDesc(""); }}>Cancel Edit</Button>
                  </div>
                )}
              </form>
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {categories.map((cat) => (
                  <div key={cat.id} className="flex items-center justify-between gap-2 p-2 border rounded-md">
                    <div>
                      <p className="font-medium text-sm">{cat.name}</p>
                      {cat.description && <p className="text-xs text-muted-foreground">{cat.description}</p>}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" onClick={() => { setEditingCategory(cat); setNewCatName(cat.name); setNewCatDesc(cat.description || ""); }}><Pencil className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => deleteCategory.mutate(cat.id)}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>
            <TabsContent value="shelves" className="space-y-4">
              <form onSubmit={handleShelfSubmit} className="space-y-3">
                <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                  <div className="space-y-1.5">
                    <Label htmlFor="library-setup-shelf-name">Bookshelf name</Label>
                    <Input id="library-setup-shelf-name" value={shelfName} onChange={(e) => setShelfName(e.target.value)} placeholder="Enter bookshelf name" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="library-setup-shelf-description">Description (optional)</Label>
                    <Input id="library-setup-shelf-description" value={shelfDescription} onChange={(e) => setShelfDescription(e.target.value)} placeholder="Enter description" />
                  </div>
                  <div className="flex items-end">
                    <Button type="submit" className="w-full md:w-auto" disabled={createShelf.isPending || updateShelf.isPending}>{editingShelf ? "Update" : "Add Bookshelf"}</Button>
                  </div>
                </div>
                {editingShelf && (
                  <div className="flex justify-end">
                    <Button type="button" variant="outline" onClick={() => { setEditingShelf(null); setShelfName(""); setShelfDescription(""); }}>Cancel Edit</Button>
                  </div>
                )}
              </form>
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {shelves.map((shelf) => (
                  <div key={shelf.id} className="flex items-center justify-between gap-2 p-2 border rounded-md">
                    <div>
                      <p className="font-medium text-sm">{shelf.name}</p>
                      {shelf.description && <p className="text-xs text-muted-foreground">{shelf.description}</p>}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button type="button" variant="ghost" size="icon" onClick={() => { setEditingShelf(shelf); setShelfName(shelf.name || ""); setShelfDescription(shelf.description || ""); }}><Pencil className="w-4 h-4" /></Button>
                      <Button type="button" variant="ghost" size="icon" onClick={() => deleteShelf.mutate(shelf.id)}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      <Dialog open={isCategoriesOpen} onOpenChange={setIsCategoriesOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Manage Categories</DialogTitle>
            <DialogDescription>Add, edit, or remove book categories</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCategorySubmit} className="space-y-3">
            <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
              <div className="space-y-1.5">
                <Label htmlFor="catalog-category-name" className="text-sm font-semibold">Category name</Label>
                <Input
                  id="catalog-category-name"
                  placeholder="Enter category name"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  required
                  data-testid="input-category-name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="catalog-category-description" className="text-sm font-semibold">Description (optional)</Label>
                <Input
                  id="catalog-category-description"
                  placeholder="Enter description"
                  value={newCatDesc}
                  onChange={(e) => setNewCatDesc(e.target.value)}
                  data-testid="input-category-description"
                />
              </div>
              <div className="flex items-end">
                <Button type="submit" className="w-full md:w-auto" disabled={createCategory.isPending || updateCategory.isPending} data-testid="button-submit-category">
                  {editingCategory ? "Update" : "Add Category"}
                </Button>
              </div>
            </div>
            {editingCategory && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditingCategory(null);
                  setNewCatName("");
                  setNewCatDesc("");
                }}
                data-testid="button-cancel-edit-category"
              >
                Cancel Edit
              </Button>
            )}
          </form>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {categories.map((cat) => (
              <div key={cat.id} className="flex items-center justify-between gap-2 p-2 border rounded-md" data-testid={`row-category-${cat.id}`}>
                <div>
                  <p className="font-medium text-sm">{cat.name}</p>
                  {cat.description && <p className="text-xs text-muted-foreground">{cat.description}</p>}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setEditingCategory(cat);
                      setNewCatName(cat.name);
                      setNewCatDesc(cat.description || "");
                    }}
                    data-testid={`button-edit-category-${cat.id}`}
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteCategory.mutate(cat.id)}
                    data-testid={`button-delete-category-${cat.id}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
            {categories.length === 0 && (
              <p className="text-center text-sm text-muted-foreground py-4">No categories yet</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isShelfManagerOpen} onOpenChange={(open) => { setIsShelfManagerOpen(open); if (!open) { setEditingShelf(null); setShelfName(""); setShelfDescription(""); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">BOOK SHELVES</DialogTitle>
            <DialogDescription>Create, edit, or delete shelves for this school only.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleShelfSubmit} className="space-y-3">
            <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
              <div className="space-y-1.5">
                <Label htmlFor="shelfName" className="text-sm font-semibold">Bookshelf Name</Label>
                <Input id="shelfName" value={shelfName} onChange={(e) => setShelfName(e.target.value)} placeholder="Enter bookshelf name" data-testid="input-shelf-name" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="shelfDescription" className="text-sm font-semibold">Description (optional)</Label>
                <Input id="shelfDescription" value={shelfDescription} onChange={(e) => setShelfDescription(e.target.value)} placeholder="Enter description" data-testid="input-shelf-description" />
              </div>
              <div className="flex items-end">
                <Button type="submit" className="w-full md:w-auto" disabled={createShelf.isPending || updateShelf.isPending} data-testid="button-submit-shelf">
                  {editingShelf ? "Update" : "Add Bookshelf"}
                </Button>
              </div>
            </div>
            {editingShelf && (
              <div className="flex justify-end">
                <Button type="button" variant="outline" onClick={() => { setEditingShelf(null); setShelfName(""); setShelfDescription(""); }} data-testid="button-cancel-shelf-edit">
                  Cancel Edit
                </Button>
              </div>
            )}
          </form>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {["N/A", "Other"].map((fixedShelf) => (
              <div key={fixedShelf} className="flex items-center justify-between gap-2 p-2 border rounded-md bg-muted/30">
                <div>
                  <p className="font-medium text-sm">{fixedShelf}</p>
                  <p className="text-[11px] leading-tight text-muted-foreground">System option</p>
                </div>
              </div>
            ))}
            {shelves.map((shelf) => (
              <div key={shelf.id} className="flex items-center justify-between gap-2 p-2 border rounded-md" data-testid={`row-shelf-${shelf.id}`}>
                <div>
                  <p className="font-medium text-sm">{shelf.name}</p>
                  {shelf.description && <p className="text-xs text-muted-foreground">{shelf.description}</p>}
                </div>
                <div className="flex items-center gap-1">
                  <Button type="button" variant="ghost" size="icon" onClick={() => { setEditingShelf(shelf); setShelfName(shelf.name || ""); setShelfDescription(shelf.description || ""); setIsShelfManagerOpen(true); }} data-testid={`button-edit-shelf-${shelf.id}`}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" onClick={() => deleteShelf.mutate(shelf.id)} data-testid={`button-delete-shelf-${shelf.id}`}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
            {shelves.length === 0 && <p className="text-center text-sm text-muted-foreground py-4">No custom shelves yet</p>}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isImportOpen} onOpenChange={(v) => { setIsImportOpen(v); if (!v) { setImportFile(null); setImportResult(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Upload Library Books</DialogTitle>
            <DialogDescription>
              Upload an Excel file (.xlsx) with columns: Title, ISBN, Author, Publisher, Subject, Shelf, Total.
              All stats except Total will be reset (Available = Total, Borrowed/Damaged/Lost = 0).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <label
              htmlFor="import-file"
              className="flex flex-col items-center justify-center border-2 border-dashed rounded-md p-8 cursor-pointer hover-elevate transition-colors"
              data-testid="upload-import-file"
            >
              {importFile ? (
                <div className="text-center">
                  <FileSpreadsheet className="w-8 h-8 mx-auto mb-2 text-green-600" />
                  <p className="text-sm font-medium">{importFile.name}</p>
                  <p className="text-[11px] leading-tight text-muted-foreground">{(importFile.size / 1024).toFixed(1)} KB</p>
                </div>
              ) : (
                <div className="text-center">
                  <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Click to select Excel file (.xlsx)</p>
                </div>
              )}
              <input
                id="import-file"
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) setImportFile(file);
                }}
              />
            </label>
            {importResult && (
              <div className="border rounded-md p-3 space-y-1">
                <p className="text-sm font-semibold text-green-600">Import Complete</p>
                <p className="text-sm">New books imported: <span className="font-medium">{importResult.imported}</span></p>
                <p className="text-sm">Existing books updated: <span className="font-medium">{importResult.updated}</span></p>
                <p className="text-sm">Skipped: <span className="font-medium">{importResult.skipped}</span></p>
                <p className="text-sm">Total rows: <span className="font-medium">{importResult.total}</span></p>
              </div>
            )}
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => { setIsImportOpen(false); setImportFile(null); setImportResult(null); }} data-testid="button-cancel-import">
                Cancel
              </Button>
              <Button
                onClick={() => { if (importFile) importBooks.mutate(importFile); }}
                disabled={!importFile || importBooks.isPending}
                data-testid="button-submit-import"
              >
                {importBooks.isPending ? "Uploading..." : "Upload Books"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent className="p-4">
          {booksLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-32 w-full" />
              ))}
            </div>
          ) : filteredBooks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <BookOpen className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Books Found</h3>
              <p className="text-muted-foreground text-center">
                {searchTerm || filterCategory !== "all" ? "Try adjusting your filters" : "Add your first book to get started"}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {filteredBooks.map((book) => {
                const borrowed = Math.max((book.totalCopies || 0) - (book.availableCopies || 0) - (book.damagedCopies || 0), 0);
                return (
                  <div
                    key={book.id}
                    className="flex h-full items-start justify-between gap-3 rounded-lg border p-4"
                    data-testid={`row-book-${book.id}`}
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      {book.coverImage && (
                        <img src={book.coverImage} alt={book.title} className="w-12 h-16 object-cover rounded-md flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0 space-y-1">
                        <p className="text-sm font-bold" data-testid={`text-book-title-${book.id}`}>{book.title}</p>
                        <p className="text-sm text-muted-foreground">
                          <span className="font-semibold">ISBN:</span> {book.isbn || "-"} | <span className="font-semibold">Author:</span> {book.author || "-"}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          <span className="font-semibold">Subject:</span> {getSubjectName(book.subjectId)} | <span className="font-semibold">Stream:</span> {Array.isArray((book as any).streamIds) && (book as any).streamIds.length > 0
                            ? (book as any).streamIds.map((sid: number) => streams.find(s => s.id === sid)?.name || `#${sid}`).join(", ")
                            : book.streamId ? (streams.find(s => s.id === book.streamId)?.name || "-") : "-"} | <span className="font-semibold">Shelf:</span> {book.shelfLocation || "-"}
                        </p>
                        <p className="text-sm">
                          <span className="font-semibold text-green-600 dark:text-green-400" data-testid={`text-available-${book.id}`}>Available: {book.availableCopies || 0}</span>
                          {" | "}
                          <span className="font-semibold text-blue-600 dark:text-blue-400" data-testid={`text-borrowed-${book.id}`}>Borrowed: {borrowed}</span>
                          {" | "}
                          <span className="font-semibold text-red-600 dark:text-red-400" data-testid={`text-damaged-${book.id}`}>Damaged: {book.damagedCopies || 0}</span>
                          {" | "}
                          <span className="font-semibold text-muted-foreground" data-testid={`text-lost-stolen-${book.id}`}>Lost/Stolen: {book.lostStolenCopies || 0}</span>
                        </p>
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" data-testid={`button-actions-book-${book.id}`}>
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => {
                            setAddCopyBookId(book.id);
                            setAddCopyQrCode("");
                            setAddCopyCondition("Good");
                          }}
                          data-testid={`button-add-copy-${book.id}`}
                        >
                          <BookCopy className="h-3.5 w-3.5 mr-2" /> Add Copy
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setViewCopiesBookId(book.id)}
                          data-testid={`button-view-copies-${book.id}`}
                        >
                          <Search className="w-4 h-4 mr-2" /> View Copies ({book.totalCopies || 0})
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => {
                          const nextStreamIds = Array.isArray((book as any).streamIds) && (book as any).streamIds.length > 0
                            ? (book as any).streamIds.map((id: number) => String(id))
                            : book.streamId ? [String(book.streamId)] : [];
                          setAutoFillStreamIds(nextStreamIds);
                          setAutoFillStream(nextStreamIds[0] || "");
                          setSelectedShelf(book.shelfLocation || "N/A");
                          setCustomShelfName("");
                          setEditingBook(book);
                        }} data-testid={`button-edit-book-${book.id}`}>
                          <Pencil className="w-4 h-4 mr-2" /> Edit Book
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => {
                            if (confirm("Are you sure you want to delete this book?")) {
                              deleteBook.mutate(book.id);
                            }
                          }}
                          data-testid={`button-delete-book-${book.id}`}
                        >
                          <Trash2 className="w-4 h-4 mr-2" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={!!addCopyBookId}
        onOpenChange={(open) => {
          if (!open) {
            setAddCopyBookId(null);
            setAddCopyQrCode("");
            setAddCopyCondition("Good");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Book Copy</DialogTitle>
            <DialogDescription>
              Scan a QR code to register a new physical copy of "{books.find((b) => b.id === addCopyBookId)?.title}"
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>QR Code</Label>
              <Button
                type="button"
                variant="outline"
                className="w-full justify-center"
                onClick={() => setAddCopyQrOpen(true)}
                data-testid="button-scan-qr"
              >
                <Camera className="w-4 h-4 mr-2" />
                Scan QR Code
              </Button>
              {addCopyQrCode.trim() && (
                <p className="text-xs text-muted-foreground" data-testid="text-scanned-copy-qr">
                  Scanned: <span className="font-mono">{addCopyQrCode}</span>
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Condition</Label>
              <Select value={addCopyCondition} onValueChange={setAddCopyCondition}>
                <SelectTrigger data-testid="select-copy-condition">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="New">New</SelectItem>
                  <SelectItem value="Good">Good</SelectItem>
                  <SelectItem value="Fair">Fair</SelectItem>
                  <SelectItem value="Poor">Poor</SelectItem>
                  <SelectItem value="Damaged">Damaged</SelectItem>
                  <SelectItem value="Lost">Lost</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              className="w-full"
              disabled={!addCopyQrCode.trim() || addCopy.isPending}
              onClick={() => {
                if (addCopyBookId && addCopyQrCode.trim()) {
                  addCopy.mutate({
                    bookId: addCopyBookId,
                    qrCode: addCopyQrCode.trim(),
                    condition: addCopyCondition,
                  });
                }
              }}
              data-testid="button-submit-copy"
            >
              {addCopy.isPending ? "Adding..." : "Add Copy"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <QrScannerDialog
        open={addCopyQrOpen}
        onOpenChange={setAddCopyQrOpen}
        onScan={(code) => {
          setAddCopyQrCode(code);
          setAddCopyQrOpen(false);
        }}
        title="Scan Book QR Code"
        description="Point your camera at the QR sticker on the book"
      />

      <QrScannerDialog
        open={scanLookupOpen}
        onOpenChange={setScanLookupOpen}
        onScan={(code) => {
          if (onScanPersonCode(code)) {
            setScanLookupOpen(false);
            return;
          }
          lookupQrCatalog.mutate(code, {
            onSuccess: () => setScanLookupOpen(false),
          });
        }}
        title="Scan Book QR Code"
        description="Scan a copy QR code to locate and manage that copy"
      />

      <Dialog open={!!selectedCopy} onOpenChange={(open) => { if (!open) { setSelectedCopy(null); setIsCopyEditing(false); setCopyEditBanner(false); setCopyAttachmentFiles([]); setAttachmentsCopy(null); setSelectedAttachment(null); } }}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <div className="space-y-3">
              <div>
                <DialogTitle>Copy Details</DialogTitle>
                <DialogDescription>{isCopyEditing ? "View or edit copy details, notes and attachments." : "View copy details, notes and attachments."}</DialogDescription>
              </div>
              <div className="flex items-center justify-end pr-10">
                {selectedCopy && !isCopyEditing && (
                  <Button type="button" variant="outline" onClick={() => setIsCopyEditing(true)} data-testid="button-edit-copy-top">
                    <Pencil className="w-4 h-4 mr-2" /> Edit
                  </Button>
                )}
                {isCopyEditing && <Badge variant="secondary">Editing</Badge>}
              </div>
            </div>
          </DialogHeader>
          {copyEditBanner && <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">Please update the recovered book if there are any changes to it</div>}
          {selectedCopy && (
            <form className="space-y-4" onSubmit={async (e) => {
              e.preventDefault();
              let attachmentUrls = [...(selectedCopy.attachmentUrls ?? [])];
              for (const file of copyAttachmentFiles) {
                const result = await uploadCopyAttachment.mutateAsync({ id: selectedCopy.id, file });
                if (result?.attachmentUrl) attachmentUrls.push(result.attachmentUrl);
              }
              updateCopy.mutate({ id: selectedCopy.id, data: { qrCode: copyDraft.qrCode.trim(), condition: copyDraft.condition || "Good", status: copyDraft.status || selectedCopy.status || "available", notes: copyDraft.notes.trim(), attachmentUrls } });
            }}>
              <div className="space-y-2"><Label>Copy QR Code</Label><Input value={copyDraft.qrCode} onChange={(e) => setCopyDraft((prev) => ({ ...prev, qrCode: e.target.value }))} readOnly={!isCopyEditing} required /></div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label>Status</Label>{isCopyEditing ? (<Select value={copyDraft.status} onValueChange={(value) => setCopyDraft((prev) => ({ ...prev, status: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="available">Available</SelectItem><SelectItem value="damaged">Damaged</SelectItem><SelectItem value="lost">Lost/Stolen</SelectItem>{selectedCopy.status === "borrowed" && <SelectItem value="borrowed">Borrowed</SelectItem>}</SelectContent></Select>) : (<div className="h-10 flex items-center">{getCopyStatusBadge(copyDraft.status)}</div>)}</div>
                <div className="space-y-2"><Label>Condition</Label>{isCopyEditing ? (<Select value={copyDraft.condition} onValueChange={(value) => setCopyDraft((prev) => ({ ...prev, condition: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Good">Good</SelectItem><SelectItem value="Fair">Fair</SelectItem><SelectItem value="Poor">Poor</SelectItem><SelectItem value="Damaged">Damaged</SelectItem><SelectItem value="Lost">Lost</SelectItem></SelectContent></Select>) : (<Input value={copyDraft.condition || "-"} readOnly />)}</div>
              </div>
              <div className="space-y-2">
                <Label>Attachments</Label>
                <div className="space-y-2 rounded-md border p-3">
                  {(selectedCopy.attachmentUrls ?? []).length === 0 && copyAttachmentFiles.length === 0 ? (
                    <span className="text-sm text-muted-foreground">No attachments yet.</span>
                  ) : null}

                  <div className="space-y-2">
                    {(selectedCopy.attachmentUrls ?? []).map((url, idx) => (
                      <div key={url + idx} className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          className="text-sm underline text-left"
                          onClick={() => {
                            setAttachmentsCopy(selectedCopy);
                            setSelectedAttachment(url);
                          }}
                        >
                          Attachment {idx + 1}
                        </button>
                        <div className="flex items-center gap-2">
                          <Button type="button" variant="outline" size="icon" title="Download" asChild>
                            <a href={url} download>
                              <Download className="w-4 h-4" />
                            </a>
                          </Button>
                          {canDeleteLibraryRecords && (
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              title="Remove"
                              onClick={() => deleteCopyAttachment.mutate({ id: selectedCopy.id, attachmentUrl: url })}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}

                    {copyAttachmentFiles.map((file, idx) => (
                      <div key={file.name + idx} className="flex items-center justify-between gap-2">
                        <span className="text-sm text-muted-foreground break-all">{file.name}</span>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          title="Remove"
                          onClick={() => setCopyAttachmentFiles((prev) => prev.filter((_, i) => i !== idx))}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>

                  {isCopyEditing && (
                    <label
                      htmlFor="copy-attachments"
                      className="flex h-10 items-center justify-center rounded-md border border-dashed text-sm cursor-pointer"
                    >
                      + Add Attachment
                      <input
                        id="copy-attachments"
                        type="file"
                        accept="image/*,.pdf"
                        multiple
                        className="hidden"
                        onChange={(e) => setCopyAttachmentFiles(Array.from(e.target.files || []))}
                      />
                    </label>
                  )}
                </div>
              </div>
              <div className="space-y-2"><Label>Notes</Label><Textarea value={copyDraft.notes} onChange={(e) => setCopyDraft((prev) => ({ ...prev, notes: e.target.value }))} rows={4} readOnly={!isCopyEditing} /></div>
              {isCopyEditing ? (<div className="flex justify-end gap-3"><Button type="button" variant="outline" onClick={() => { openCopyDetails(selectedCopy, { showRecoveryBanner: copyEditBanner }); setIsCopyEditing(false); }}>Cancel</Button><Button type="submit" disabled={updateCopy.isPending || uploadCopyAttachment.isPending}>{updateCopy.isPending || uploadCopyAttachment.isPending ? "Saving..." : "Save Changes"}</Button></div>) : null}
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!attachmentsCopy && !!selectedAttachment} onOpenChange={(open) => { if (!open) setSelectedAttachment(null); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Attachment Viewer</DialogTitle>
            <DialogDescription>Preview, download, and manage this copy attachment.</DialogDescription>
          </DialogHeader>
          {selectedAttachment && (
            <div className="space-y-4">
              {selectedAttachment.match(/\.(png|jpe?g|gif|webp|bmp|svg)$/i) ? (
                <img src={selectedAttachment} alt="Copy attachment" className="max-h-[60vh] w-full rounded-md object-contain border" />
              ) : (
                <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">Preview is not available for this file type.</div>
              )}
              <div className="flex justify-end gap-3">
                <Button type="button" variant="outline" size="icon" title="Download" asChild><a href={selectedAttachment} download><Download className="w-4 h-4" /></a></Button>
                {attachmentsCopy && canDeleteLibraryRecords && <Button type="button" variant="outline" size="icon" title="Remove" onClick={() => { deleteCopyAttachment.mutate({ id: attachmentsCopy.id, attachmentUrl: selectedAttachment }); setSelectedAttachment(null); }}><Trash2 className="w-4 h-4" /></Button>}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewCopiesBookId} onOpenChange={(open) => { if (!open) setViewCopiesBookId(null); }}>
        <DialogContent className="max-w-6xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Book Copies</DialogTitle>
            <DialogDescription>
              Individual copies of "{books.find(b => b.id === viewCopiesBookId)?.title}"
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end mb-2">
            <Button
              size="sm"
              onClick={() => {
                setAddCopyBookId(viewCopiesBookId);
                setAddCopyQrCode("");
                setAddCopyCondition("Good");
              }}
              data-testid="button-add-copy-from-view"
            >
              <Plus className="w-4 h-4 mr-2" /> Add Copy
            </Button>
          </div>
          {copiesLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : bookCopies.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <BookCopy className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p>No individual copies registered yet.</p>
              <p className="text-sm mt-1">Add copies with QR codes to track each physical book.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>QR Code</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Condition</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead>Attachments</TableHead>
                  <TableHead className="whitespace-nowrap">Date Added</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bookCopies.map((copy) => (
                  <TableRow key={copy.id} data-testid={`row-copy-${copy.id}`}>
                    <TableCell className="font-mono text-sm break-all" data-testid={`text-copy-qr-${copy.id}`}>{copy.qrCode}</TableCell>
                    <TableCell><div data-testid={`badge-copy-status-${copy.id}`}>{getCopyStatusBadge(copy.status)}</div></TableCell>
                    <TableCell data-testid={`text-copy-condition-${copy.id}`}>{copy.condition || "-"}</TableCell>
                    <TableCell className="max-w-[220px] truncate">{copy.notes || "-"}</TableCell>
                    <TableCell><Button type="button" variant="ghost" size="sm" onClick={() => { openCopyDetails(copy); if ((copy.attachmentUrls ?? []).length > 0) { setAttachmentsCopy(copy); setSelectedAttachment((copy.attachmentUrls ?? [])[0] || null); } }} data-testid={`button-copy-attachments-${copy.id}`}>{(copy.attachmentUrls ?? []).length > 0 ? `Attachments (${(copy.attachmentUrls ?? []).length})` : "Attachments (0)"}</Button></TableCell>
                    <TableCell className="whitespace-nowrap">{formatDate(copy.addedAt)}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm" title="Actions" aria-label="Actions" data-testid={`button-copy-actions-${copy.id}`}>
                            Actions <MoreHorizontal className="w-4 h-4 ml-2" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem title="View Copy" onClick={() => openCopyDetails(copy)} data-testid={`button-view-copy-${copy.id}`}><Search className="w-4 h-4 mr-2" /> View Copy</DropdownMenuItem>
                          {copy.status !== "borrowed" && copy.status !== "lost" && <DropdownMenuItem title="Mark Damaged" onClick={() => updateCopy.mutate({ id: copy.id, data: { status: "damaged", condition: "Damaged", notes: copy.notes, attachmentUrls: copy.attachmentUrls ?? [] } })} data-testid={`button-damage-copy-${copy.id}`}><AlertTriangle className="w-4 h-4 mr-2" /> Mark Damaged</DropdownMenuItem>}
                          {copy.status === "lost" ? (<DropdownMenuItem title="Mark Recovered" onClick={() => openCopyDetails({ ...copy, status: "available", condition: copy.condition === "Lost" ? "Good" : copy.condition } as LibraryBookCopy, { startEditing: true, showRecoveryBanner: true })} data-testid={`button-recover-copy-${copy.id}`}><RotateCcw className="w-4 h-4 mr-2" /> Mark Recovered</DropdownMenuItem>) : copy.status !== "borrowed" ? (<DropdownMenuItem title="Mark Lost/Stolen" onClick={() => updateCopy.mutate({ id: copy.id, data: { status: "lost", condition: "Lost", notes: copy.notes, attachmentUrls: copy.attachmentUrls ?? [] } })} data-testid={`button-lost-copy-${copy.id}`}><XCircle className="w-4 h-4 mr-2" /> Mark Lost/Stolen</DropdownMenuItem>) : null}
                          {copy.status !== "borrowed" && <DropdownMenuItem title="Delete" className="text-destructive" onClick={() => { if (confirm("Remove this copy?")) deleteCopy.mutate(copy.id); }} data-testid={`button-delete-copy-${copy.id}`}><Trash2 className="w-4 h-4 mr-2" /> Delete</DropdownMenuItem>}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CirculationTab({
  loans,
  books,
  fines,
  students,
  staff,
  loansLoading,
  onOpenLibrarySetup,
  onScanPersonCode,
}: {
  loans: LibraryLoan[];
  books: LibraryBook[];
  fines: LibraryFine[];
  students: Student[];
  staff: Staff[];
  loansLoading: boolean;
  onOpenLibrarySetup: (tab?: string) => void;
  onScanPersonCode: (code: string) => boolean;
}) {
  const { toast } = useToast();
  const [isIssueOpen, setIsIssueOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [borrowerType, setBorrowerType] = useState<"student" | "staff">("student");
  const [loanSearchTerm, setLoanSearchTerm] = useState("");
  const [scanReturnOpen, setScanReturnOpen] = useState(false);
  const [isCommunicateAlertsOpen, setIsCommunicateAlertsOpen] = useState(false);
  const [communicateAlertsTab, setCommunicateAlertsTab] = useState("overdue");
  const [communicationAudienceFilter, setCommunicationAudienceFilter] = useState("all");
  const [communicationSearch, setCommunicationSearch] = useState("");
  const [communicationMessage, setCommunicationMessage] = useState(
    "Hello {{name}}, this is a reminder from the library regarding {{issue}}. Please attend to it as soon as possible."
  );
  const [bookSearch, setBookSearch] = useState("");
  const [selectedBookId, setSelectedBookId] = useState<string>("");
  const [copySearch, setCopySearch] = useState("");
  const [selectedCopyId, setSelectedCopyId] = useState<string>("");
  const [borrowerSearch, setBorrowerSearch] = useState("");
  const [selectedBorrowerId, setSelectedBorrowerId] = useState<string>("");
  const [dueDate, setDueDate] = useState(getDefaultDueDate());
  const [conditionValue, setConditionValue] = useState("Good");
  const [copyNotes, setCopyNotes] = useState("");
  const [bookQrOpen, setBookQrOpen] = useState(false);
  const [borrowerQrOpen, setBorrowerQrOpen] = useState(false);
  const [issueMode, setIssueMode] = useState<"issue" | "return">("issue");
  const [activeReturnLoanId, setActiveReturnLoanId] = useState<number | null>(null);

  const { data: copies = [] } = useQuery<LibraryBookCopy[]>({
    queryKey: ["/api/library/copies"],
  });

  const resetIssueModal = () => {
    setBookSearch("");
    setSelectedBookId("");
    setCopySearch("");
    setSelectedCopyId("");
    setBorrowerSearch("");
    setSelectedBorrowerId("");
    setBorrowerType("student");
    setDueDate(getDefaultDueDate());
    setConditionValue("Good");
    setCopyNotes("");
    setIssueMode("issue");
    setActiveReturnLoanId(null);
  };

  const lookupQr = useMutation({
    mutationFn: async (qrCode: string) => {
      const res = await schoolFetch(`/api/library/copies/qr/${encodeURIComponent(qrCode)}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "QR code not found");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setIsIssueOpen(true);
      applyCopyLookup(data);
    },
    onError: (error: Error) => toast({ title: error.message, variant: "destructive" }),
  });

  const issueLoan = useMutation({
    mutationFn: async (data: Record<string, unknown>) => apiRequest("POST", "/api/library/loans", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/library/loans"] });
      queryClient.invalidateQueries({ queryKey: ["/api/library/books"] });
      queryClient.invalidateQueries({ queryKey: ["/api/library/copies"] });
      setIsIssueOpen(false);
      resetIssueModal();
      toast({ title: "Book issued successfully" });
    },
    onError: (error: Error) => toast({ title: error.message || "Failed to issue book", variant: "destructive" }),
  });

  const returnLoan = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Record<string, unknown> }) => apiRequest("PUT", `/api/library/loans/${id}/return`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/library/loans"] });
      queryClient.invalidateQueries({ queryKey: ["/api/library/books"] });
      queryClient.invalidateQueries({ queryKey: ["/api/library/copies"] });
      setIsIssueOpen(false);
      resetIssueModal();
      toast({ title: "Book returned successfully" });
    },
    onError: (error: Error) => toast({ title: error.message || "Failed to return book", variant: "destructive" }),
  });

  const markLost = useMutation({
    mutationFn: async (id: number) => apiRequest("PUT", `/api/library/loans/${id}/lost`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/library/loans"] });
      queryClient.invalidateQueries({ queryKey: ["/api/library/books"] });
      toast({ title: "Book marked as lost / stolen" });
    },
    onError: () => toast({ title: "Failed to mark book as lost", variant: "destructive" }),
  });


  const extendLoan = useMutation({
    mutationFn: async (id: number) => apiRequest("PUT", `/api/library/loans/${id}/extend`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/library/loans"] });
      toast({ title: "Loan extended by one day" });
    },
    onError: (error: Error) => toast({ title: error.message || "Failed to extend loan", variant: "destructive" }),
  });

  const updateCopy = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Record<string, unknown> }) => apiRequest("PUT", `/api/library/copies/${id}`, data),
  });

  const getBookTitle = (bookId: number | null | undefined) => {
    if (!bookId) return "-";
    return books.find((b) => b.id === bookId)?.title || `Book #${bookId}`;
  };

  const filteredLoans = useMemo(() => {
    let result = loans;
    if (statusFilter === "overdue") {
      result = result.filter(
        (l) =>
          l.status === "overdue" ||
          (l.status === "active" && l.dueDate && new Date(l.dueDate) < new Date())
      );
    } else if (statusFilter !== "all") {
      result = result.filter((l) => l.status === statusFilter);
    }
    if (loanSearchTerm) {
      const term = loanSearchTerm.toLowerCase();
      result = result.filter((l) => {
        const bookTitle = getBookTitle(l.bookId).toLowerCase();
        const borrowerName = (l.borrowerName || "").toLowerCase();
        return bookTitle.includes(term) || borrowerName.includes(term);
      });
    }
    return result;
  }, [loans, statusFilter, loanSearchTerm, books]);

  const availableBooks = books.filter((b) => (b.availableCopies || 0) > 0 || (b.lostStolenCopies || 0) >= 0);
  const filteredAvailableBooks = availableBooks.filter((b) =>
    b.title.toLowerCase().includes(bookSearch.toLowerCase()) ||
    (b.isbn || "").toLowerCase().includes(bookSearch.toLowerCase()) ||
    (b.author || "").toLowerCase().includes(bookSearch.toLowerCase())
  );

  const borrowerOptions = (borrowerType === "student" ? students : staff).filter((person: any) => {
    const search = borrowerSearch.toLowerCase();
    const name = `${person.firstName} ${person.lastName}`.toLowerCase();
    const code = borrowerType === "student" ? String(person.admissionNo || "").toLowerCase() : String(person.staffNo || "").toLowerCase();
    return name.includes(search) || code.includes(search);
  });

  const selectedBook = useMemo(() => books.find((b) => String(b.id) === selectedBookId) || null, [books, selectedBookId]);
  const selectedCopy = useMemo(() => copies.find((c) => String(c.id) === selectedCopyId) || null, [copies, selectedCopyId]);
  const copyOptions = useMemo(() => {
    const base = selectedBook ? copies.filter((copy) => copy.bookId === selectedBook.id) : [];
    return base.filter((copy) => {
      const search = copySearch.toLowerCase();
      return !search || String(copy.id).includes(search) || (copy.qrCode || "").toLowerCase().includes(search) || (copy.notes || "").toLowerCase().includes(search);
    });
  }, [copies, selectedBook, copySearch]);
  const selectedBorrower = useMemo(() => {
    const list: any[] = borrowerType === "student" ? students : staff;
    return list.find((person) => String(person.id) === selectedBorrowerId) || null;
  }, [borrowerType, students, staff, selectedBorrowerId]);
  const activeLoanForSelectedCopy = useMemo(() => loans.find((loan) => loan.copyId === (selectedCopy ? selectedCopy.id : -1) && ["active", "overdue"].includes(String(loan.status))) || null, [loans, selectedCopy]);

  useEffect(() => {
    if (!selectedCopy) {
      setIssueMode("issue");
      setActiveReturnLoanId(null);
      setCopyNotes("");
      return;
    }
    setCopyNotes(selectedCopy.notes || "");
    if (selectedBookId !== String(selectedCopy.bookId)) {
      setSelectedBookId(String(selectedCopy.bookId));
    }
    if (activeLoanForSelectedCopy) {
      setIssueMode("return");
      setActiveReturnLoanId(activeLoanForSelectedCopy.id);
      setConditionValue(selectedCopy.condition || activeLoanForSelectedCopy.conditionOnBorrow || "Good");
    } else {
      setIssueMode("issue");
      setActiveReturnLoanId(null);
      setConditionValue(selectedCopy.condition || "Good");
    }
  }, [selectedCopy, activeLoanForSelectedCopy]);

  useEffect(() => {
    if (!selectedBook) {
      setSelectedCopyId("");
      setCopySearch("");
      return;
    }
    if (selectedCopy && selectedCopy.bookId !== selectedBook.id) {
      setSelectedCopyId("");
      setCopyNotes("");
    }
  }, [selectedBookId]);

  const applyCopyLookup = (data: any) => {
    const copy = data?.copy;
    const book = data?.book;
    const activeLoan = data?.activeLoan;
    if (!copy || !book) return;
    setSelectedBookId(String(book.id));
    setBookSearch(book.title || "");
    setSelectedCopyId(String(copy.id));
    setCopySearch(copy.qrCode || String(copy.id));
    setCopyNotes(copy.notes || "");
    if (activeLoan) {
      setIssueMode("return");
      setActiveReturnLoanId(activeLoan.id);
      setConditionValue(copy.condition || activeLoan.conditionOnBorrow || "Good");
    } else {
      setIssueMode("issue");
      setActiveReturnLoanId(null);
      setConditionValue(copy.condition || "Good");
    }
  };

  type CommunicationRecipient = {
    id: string;
    borrowerName: string;
    borrowerType: "student" | "staff";
    audience: string;
    channels: string;
    issue: string;
    detail: string;
    messageHint?: string;
  };

  const buildCommunicationRecipient = (
    key: string,
    borrowerName: string | null | undefined,
    borrowerType: string | null | undefined,
    issue: string,
    detail: string,
    messageHint?: string,
  ): CommunicationRecipient => ({
    id: key,
    borrowerName: borrowerName || "Unknown borrower",
    borrowerType: borrowerType === "staff" ? "staff" : "student",
    audience: borrowerType === "student" ? "Student + Parent(s)" : "Staff",
    channels: "All available channels",
    issue,
    detail,
    messageHint,
  });

  const overdueRecipients = useMemo(() => {
    return loans
      .filter(
        (loan) =>
          loan.status === "overdue" ||
          (loan.status === "active" && loan.dueDate && new Date(loan.dueDate) < new Date())
      )
      .map((loan) =>
        buildCommunicationRecipient(
          `overdue-${loan.id}`,
          loan.borrowerName,
          loan.borrowerType,
          "Overdue book",
          `${getBookTitle(loan.bookId)} • Due ${formatDate(loan.dueDate)}`,
          `${loan.borrowerName || "Borrower"} has an overdue book: ${getBookTitle(loan.bookId)}.`
        )
      );
  }, [loans, books]);

  const unpaidFineRecipients = useMemo(() => {
    return fines
      .filter((fine) => fine.status === "unpaid")
      .map((fine) => {
        const relatedLoan = loans.find((loan) => loan.id === fine.loanId);
        return buildCommunicationRecipient(
          `fine-${fine.id}`,
          relatedLoan?.borrowerName,
          relatedLoan?.borrowerType,
          "Unpaid fine",
          `${fine.reason || "Library fine"} • $${parseFloat(fine.amount || "0").toFixed(2)}`,
          `${relatedLoan?.borrowerName || "Borrower"} has an unpaid fine of $${parseFloat(fine.amount || "0").toFixed(2)}.`
        );
      });
  }, [fines, loans]);

  const lostRecipients = useMemo(() => {
    return loans
      .filter((loan) => loan.status === "lost")
      .map((loan) =>
        buildCommunicationRecipient(
          `lost-${loan.id}`,
          loan.borrowerName,
          loan.borrowerType,
          "Lost book",
          `${getBookTitle(loan.bookId)} • Marked lost`,
          `${loan.borrowerName || "Borrower"} has a book recorded as lost: ${getBookTitle(loan.bookId)}.`
        )
      );
  }, [loans, books]);

  const damagedRecipients = useMemo(() => {
    return fines
      .filter((fine) => (fine.reason || "").toLowerCase().includes("damag"))
      .map((fine) => {
        const relatedLoan = loans.find((loan) => loan.id === fine.loanId);
        return buildCommunicationRecipient(
          `damaged-${fine.id}`,
          relatedLoan?.borrowerName,
          relatedLoan?.borrowerType,
          "Damaged book",
          `${getBookTitle(relatedLoan?.bookId)} • ${fine.reason || "Damage noted"}`,
          `${relatedLoan?.borrowerName || "Borrower"} has a damaged-book related alert.`
        );
      });
  }, [fines, loans, books]);

  const customRecipients = useMemo(() => {
    const seen = new Set<string>();
    return loans
      .filter((loan) => loan.borrowerName)
      .filter((loan) => {
        const key = `${loan.borrowerType}-${loan.borrowerId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((loan) =>
        buildCommunicationRecipient(
          `custom-${loan.id}`,
          loan.borrowerName,
          loan.borrowerType,
          "Custom communication",
          `${getBookTitle(loan.bookId)} • Library contact`,
          `This is a custom library communication for ${loan.borrowerName || "the borrower"}.`
        )
      );
  }, [loans, books]);

  const communicationTabs: Record<string, { label: string; recipients: CommunicationRecipient[]; empty: string }> = {
    overdue: { label: "Overdue Books", recipients: overdueRecipients, empty: "No overdue borrowers currently need alerts." },
    fines: { label: "Unpaid Fines", recipients: unpaidFineRecipients, empty: "No unpaid fine alerts are pending." },
    damaged: { label: "Damaged Books", recipients: damagedRecipients, empty: "No borrower-linked damaged book alerts are available yet." },
    lost: { label: "Lost Books", recipients: lostRecipients, empty: "No lost book alerts are pending." },
    custom: { label: "Custom", recipients: customRecipients, empty: "No borrowers are available for custom communication right now." },
  };

  const activeCommunication = communicationTabs[communicateAlertsTab] || communicationTabs.overdue;
  const filteredCommunicationRecipients = activeCommunication.recipients.filter((recipient) => {
    const matchesAudience = communicationAudienceFilter === "all" || recipient.borrowerType === communicationAudienceFilter;
    const search = communicationSearch.toLowerCase().trim();
    const matchesSearch = !search || recipient.borrowerName.toLowerCase().includes(search) || recipient.detail.toLowerCase().includes(search) || recipient.issue.toLowerCase().includes(search);
    return matchesAudience && matchesSearch;
  });

  const communicationSummary = filteredCommunicationRecipients.reduce(
    (acc, recipient) => {
      if (recipient.borrowerType === "student") {
        acc.students += 1;
        acc.parents += 1;
      } else {
        acc.staff += 1;
      }
      return acc;
    },
    { students: 0, parents: 0, staff: 0 }
  );

  const previewRecipient = filteredCommunicationRecipients[0];
  const communicationPreview = previewRecipient
    ? communicationMessage
        .replace(/\{\{name\}\}/g, previewRecipient.borrowerName)
        .replace(/\{\{issue\}\}/g, previewRecipient.issue.toLowerCase())
    : communicationMessage;

  const handleBorrowerQrScan = (code: string) => {
    const trimmed = code.trim().toLowerCase();
    const match = borrowerType === "student"
      ? students.find((student) => String(student.admissionNo || "").toLowerCase() === trimmed)
      : staff.find((member) => String(member.staffNo || "").toLowerCase() === trimmed);
    if (!match) {
      toast({ title: `${borrowerType === "student" ? "Student" : "Staff member"} not found for scanned QR code`, variant: "destructive" });
      return;
    }
    setSelectedBorrowerId(String(match.id));
    setBorrowerSearch(`${match.firstName} ${match.lastName}`);
  };

  const handleIssueOrReturn = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedBook) {
      toast({ title: "Please select a book", variant: "destructive" });
      return;
    }
    if (!selectedCopy) {
      toast({ title: "Please select a copy ID", variant: "destructive" });
      return;
    }

    if (issueMode === "issue") {
      if (!selectedBorrowerId) {
        toast({ title: `Please select a ${borrowerType}`, variant: "destructive" });
        return;
      }
      await updateCopy.mutateAsync({
        id: selectedCopy.id,
        data: {
          qrCode: selectedCopy.qrCode,
          condition: conditionValue,
          status: selectedCopy.status || "available",
          notes: copyNotes,
          attachmentUrls: selectedCopy.attachmentUrls ?? [],
        },
      });
      const borrowerName = borrowerType === "student"
        ? `${selectedBorrower?.firstName || ""} ${selectedBorrower?.lastName || ""}`.trim()
        : `${selectedBorrower?.firstName || ""} ${selectedBorrower?.lastName || ""}`.trim();
      issueLoan.mutate({
        bookId: selectedBook.id,
        copyId: selectedCopy.id,
        borrowerType,
        borrowerId: parseInt(selectedBorrowerId, 10),
        borrowerName,
        dueDate,
        conditionOnBorrow: conditionValue,
        notes: copyNotes,
      });
      return;
    }

    if (!activeReturnLoanId) {
      toast({ title: "No active loan found for this copy", variant: "destructive" });
      return;
    }
    returnLoan.mutate({
      id: activeReturnLoanId,
      data: {
        condition: conditionValue,
        notes: copyNotes,
      },
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-3 flex-1 min-w-0 flex-wrap">
          <div className="relative w-full basis-full md:basis-auto md:flex-1 md:min-w-[260px] md:max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by book or borrower..."
              value={loanSearchTerm}
              onChange={(e) => setLoanSearchTerm(e.target.value)}
              className="pl-10"
              data-testid="input-search-loans"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-[180px]" data-testid="select-loan-status-filter">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Loans</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="returned">Returned</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
              <SelectItem value="lost">Lost</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={() => setIsCommunicateAlertsOpen(true)} data-testid="button-communicate-alerts">
            <BellRing className="w-4 h-4 mr-2" /> Communicate Alerts
          </Button>
          <Button variant="outline" onClick={() => onOpenLibrarySetup("policies")} data-testid="button-library-setup-circulation">
            <Settings className="w-4 h-4 mr-2" /> Library Setup
          </Button>
          <Button variant="outline" onClick={() => setScanReturnOpen(true)} data-testid="button-scan-qr-return">
            <Camera className="w-4 h-4 mr-2" /> Scan QR Code
          </Button>
          <Button onClick={() => { resetIssueModal(); setIsIssueOpen(true); }} data-testid="button-issue-book">
            <Plus className="w-4 h-4 mr-2" /> Issue/Return Book
          </Button>
        </div>
      </div>

      <Dialog open={isCommunicateAlertsOpen} onOpenChange={setIsCommunicateAlertsOpen}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Communicate Alerts</DialogTitle>
            <DialogDescription>
              Prepare borrower communications for overdue books, fines, damaged books, lost books, and custom reminders. Students will notify the student and parent(s) through all available channels.
            </DialogDescription>
          </DialogHeader>

          <Tabs value={communicateAlertsTab} onValueChange={setCommunicateAlertsTab} className="w-full">
            <TabsList className="mb-4 grid h-auto w-full grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
              <TabsTrigger value="overdue">Overdue Books</TabsTrigger>
              <TabsTrigger value="fines">Unpaid Fines</TabsTrigger>
              <TabsTrigger value="damaged">Damaged Books</TabsTrigger>
              <TabsTrigger value="lost">Lost Books</TabsTrigger>
              <TabsTrigger value="custom">Custom</TabsTrigger>
            </TabsList>
            <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex gap-3 flex-1 min-w-0 flex-wrap">
                    <Select value={communicationAudienceFilter} onValueChange={setCommunicationAudienceFilter}>
                      <SelectTrigger className="w-full sm:w-[180px]">
                        <SelectValue placeholder="Audience" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Audiences</SelectItem>
                        <SelectItem value="student">Students + Parent(s)</SelectItem>
                        <SelectItem value="staff">Staff</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="relative w-full basis-full md:basis-auto md:flex-1 md:min-w-[260px] md:max-w-md">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        value={communicationSearch}
                        onChange={(e) => setCommunicationSearch(e.target.value)}
                        placeholder="Search recipients or issues..."
                        className="pl-10"
                      />
                    </div>
                  </div>
                  <Badge variant="secondary">{activeCommunication.label}</Badge>
                </div>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Recipients</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {filteredCommunicationRecipients.length === 0 ? (
                      <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
                        {activeCommunication.empty}
                      </div>
                    ) : (
                      filteredCommunicationRecipients.map((recipient) => (
                        <div key={recipient.id} className="rounded-md border p-3 space-y-1.5">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-semibold">{recipient.borrowerName}</p>
                              <p className="text-sm text-muted-foreground">Audience: {recipient.audience}</p>
                            </div>
                            <Badge variant={recipient.borrowerType === "student" ? "secondary" : "outline"}>
                              {recipient.borrowerType === "student" ? "Student + Parent(s)" : "Staff"}
                            </Badge>
                          </div>
                          <p className="text-sm"><span className="font-medium">Issue:</span> {recipient.issue}</p>
                          <p className="text-sm text-muted-foreground">{recipient.detail}</p>
                          <p className="text-[11px] leading-tight text-muted-foreground">Channels: {recipient.channels}</p>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Communication Scope</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <p><span className="font-medium">Recipients selected:</span> {filteredCommunicationRecipients.length}</p>
                    <p><span className="font-medium">Will notify:</span> {communicationSummary.students} student(s), {communicationSummary.parents} parent/guardian group(s), {communicationSummary.staff} staff member(s)</p>
                    <p><span className="font-medium">Channels:</span> All available channels only</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Message Template</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline">{"{{name}}"}</Badge>
                      <Badge variant="outline">{"{{issue}}"}</Badge>
                    </div>
                    <Textarea
                      value={communicationMessage}
                      onChange={(e) => setCommunicationMessage(e.target.value)}
                      rows={6}
                      placeholder="Write your alert message..."
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Preview</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="rounded-md bg-muted/50 p-3 text-sm whitespace-pre-wrap">
                      {communicationPreview}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </Tabs>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setIsCommunicateAlertsOpen(false)}>Cancel</Button>
            <Button type="button">Prepare Message</Button>
          </div>
        </DialogContent>
      </Dialog>

      <QrScannerDialog
        open={scanReturnOpen}
        onOpenChange={(open) => {
          setScanReturnOpen(open);
        }}
        onScan={(code) => {
          if (onScanPersonCode(code)) {
            setScanReturnOpen(false);
            return;
          }
          setScanReturnOpen(false);
          lookupQr.mutate(code);
        }}
        title="Scan Book QR Code"
        description="Scan a book's QR code to look up its loan status"
      />

      <QrScannerDialog
        open={bookQrOpen}
        onOpenChange={setBookQrOpen}
        onScan={(code) => {
          lookupQr.mutate(code, { onSuccess: (data) => { applyCopyLookup(data); setBookQrOpen(false); } });
        }}
        title="Scan Book QR Code"
        description="Scan a copy QR code to auto-fill the book and copy details"
      />

      <QrScannerDialog
        open={borrowerQrOpen}
        onOpenChange={setBorrowerQrOpen}
        onScan={(code) => {
          handleBorrowerQrScan(code);
          setBorrowerQrOpen(false);
        }}
        title={`Scan ${borrowerType === "student" ? "Student" : "Staff"} QR Code`}
        description={`Scan the ${borrowerType === "student" ? "admission" : "staff"} QR code to auto-fill the borrower`}
      />

      <Dialog open={isIssueOpen} onOpenChange={(open) => { setIsIssueOpen(open); if (!open) resetIssueModal(); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Issue / Return Book</DialogTitle>
            <DialogDescription>
              {issueMode === "issue" ? "Issue a selected copy to a borrower" : "Return a borrowed copy and update its condition and notes"}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleIssueOrReturn} className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label>Book</Label>
                <Button type="button" variant="outline" size="sm" onClick={() => setBookQrOpen(true)}>
                  <Camera className="w-4 h-4 mr-2" /> Scan QR Code
                </Button>
              </div>
              <SearchablePicker
                placeholder="Search and select a book..."
                searchValue={bookSearch}
                onSearchChange={setBookSearch}
                options={filteredAvailableBooks.map((b) => ({ id: b.id.toString(), label: `${b.title} (${b.availableCopies} available)` }))}
                selectedId={selectedBookId}
                onSelect={(id, label) => { setSelectedBookId(id); setBookSearch(label); }}
                dataTestId="input-search-available-books"
              />
            </div>

            <div className="space-y-2">
              <Label>Condition {issueMode === "issue" ? "on Borrow" : "on Return"}</Label>
              <Select value={conditionValue} onValueChange={setConditionValue}>
                <SelectTrigger data-testid="select-condition-on-borrow">
                  <SelectValue placeholder="Select condition" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Good">Good</SelectItem>
                  <SelectItem value="Fair">Fair</SelectItem>
                  <SelectItem value="Poor">Poor</SelectItem>
                  <SelectItem value="Damaged">Damaged</SelectItem>
                  {issueMode === "return" && <SelectItem value="Lost">Lost</SelectItem>}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Copy ID</Label>
              <SearchablePicker
                placeholder="Search and select a copy ID..."
                searchValue={copySearch}
                onSearchChange={setCopySearch}
                options={copyOptions.map((copy) => ({ id: copy.id.toString(), label: `Copy #${copy.id} • ${copy.qrCode} • ${copy.status}` }))}
                selectedId={selectedCopyId}
                onSelect={(id, label) => { setSelectedCopyId(id); setCopySearch(label); }}
                emptyText="No matching copies found"
                dataTestId="input-search-copy"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-[1fr_1fr] items-start">
              <div className="space-y-2">
                <Label>Borrower Type</Label>
                <div className="flex h-10 items-center gap-4 rounded-md border px-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" checked={borrowerType === "student"} onChange={() => { setBorrowerType("student"); setSelectedBorrowerId(""); setBorrowerSearch(""); }} />
                    <span>Student</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" checked={borrowerType === "staff"} onChange={() => { setBorrowerType("staff"); setSelectedBorrowerId(""); setBorrowerSearch(""); }} />
                    <span>Staff</span>
                  </label>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="dueDate">Due Date</Label>
                <Input id="dueDate" type="datetime-local" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required disabled={issueMode === "return"} data-testid="input-due-date" />
              </div>
            </div>

            {issueMode === "issue" ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <Label>Borrower</Label>
                  <Button type="button" variant="outline" size="sm" onClick={() => setBorrowerQrOpen(true)}>
                    <Camera className="w-4 h-4 mr-2" /> Scan QR Code
                  </Button>
                </div>
                <SearchablePicker
                  placeholder={`Search and select ${borrowerType}...`}
                  searchValue={borrowerSearch}
                  onSearchChange={setBorrowerSearch}
                  options={borrowerOptions.map((person: any) => ({ id: person.id.toString(), label: `${person.firstName} ${person.lastName} ${borrowerType === "student" ? `• ${person.admissionNo || ""}` : `• ${person.staffNo || ""}`}` }))}
                  selectedId={selectedBorrowerId}
                  onSelect={(id, label) => { setSelectedBorrowerId(id); setBorrowerSearch(label); }}
                  emptyText={`No matching ${borrowerType}s found`}
                  dataTestId="input-search-borrower"
                />
              </div>
            ) : (
              <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
                <p className="font-medium">Returning borrower</p>
                <p>{activeLoanForSelectedCopy?.borrowerName || "-"}</p>
                <p className="text-muted-foreground">Please verbally verify that the person returning the book matches this borrower.</p>
              </div>
            )}

            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea value={copyNotes} onChange={(e) => setCopyNotes(e.target.value)} rows={4} placeholder="Add or update notes for this copy" />
            </div>

            <Button type="submit" className="w-full" disabled={issueLoan.isPending || returnLoan.isPending || updateCopy.isPending} data-testid="button-submit-issue">
              {issueLoan.isPending || returnLoan.isPending || updateCopy.isPending
                ? (issueMode === "issue" ? "Processing issue..." : "Processing return...")
                : (issueMode === "issue" ? "Issue Book" : "Return Book")}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent className="p-0">
          {loansLoading ? (
            <div className="space-y-3 p-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredLoans.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <ArrowRightLeft className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Loans Found</h3>
              <p className="text-muted-foreground">
                {statusFilter !== "all" ? "Try changing the status filter" : "No books have been issued yet"}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2">
              {filteredLoans.map((loan) => {
                const conditionOnBorrowValue = loan.conditionOnBorrow || "-";
                const conditionOnBorrowDisplay = conditionOnBorrowValue !== "-" ? conditionOnBorrowValue.charAt(0).toUpperCase() + conditionOnBorrowValue.slice(1) : "-";
                const conditionOnReturnValue = (loan as any).conditionOnReturn || "-";
                const conditionOnReturnDisplay = conditionOnReturnValue !== "-" ? conditionOnReturnValue.charAt(0).toUpperCase() + conditionOnReturnValue.slice(1) : "-";
                const now = new Date();
                const dueDate = loan.dueDate ? new Date(loan.dueDate) : null;
                const remainingDays = dueDate ? Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null;
                const isReturned = loan.status === "returned";
                const copyId = loan.copyId || "-";

                let remainingColor = "text-green-600 dark:text-green-400 font-bold";
                if (remainingDays !== null && remainingDays < 0) {
                  remainingColor = "text-red-600 dark:text-red-400 font-bold";
                } else if (remainingDays !== null && remainingDays <= 3) {
                  remainingColor = "text-orange-500 dark:text-yellow-400 font-bold";
                }

                return (
                  <div key={loan.id} className="flex h-full items-start justify-between gap-3 rounded-lg border p-4" data-testid={`row-loan-${loan.id}`}>
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <p className="text-sm font-bold" data-testid={`text-borrower-name-${loan.id}`}>
                        {loan.borrowerName || "-"} <span className="text-sm font-normal text-muted-foreground">({loan.borrowerType === "student" ? "Student" : "Staff"})</span>
                      </p>
                      <p className="text-sm text-muted-foreground">
                        <span className="font-semibold">Book:</span> {getBookTitle(loan.bookId)}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        <span className="font-semibold">Copy ID:</span> {copyId}
                      </p>
                      <p className="text-sm">
                        <span className="font-semibold">Status On Borrow:</span>{" "}
                        <span className="text-green-600 dark:text-green-400">{conditionOnBorrowDisplay}</span>
                      </p>
                      <p className="text-sm">
                        <span className="font-semibold">Status On Return:</span>{" "}
                        <span className={isReturned ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground"}>
                          {isReturned ? conditionOnReturnDisplay : "-"}
                        </span>
                      </p>
                      <p className="text-sm text-muted-foreground">
                        <span className="font-semibold">Issue Date:</span> {formatDate(loan.issuedAt)} | <span className="font-semibold">Due Date:</span> {formatDate(loan.dueDate)} | <span className="font-semibold">Return Date:</span> {isReturned ? formatDate(loan.returnedAt) : <span className="italic text-muted-foreground">Not returned</span>}
                      </p>
                      {(loan as any).markedLostAt ? (
                        <p className="text-sm text-muted-foreground">
                          <span className="font-semibold">Marked Lost/Stolen On:</span> {formatDate((loan as any).markedLostAt)}
                          {(loan as any).markedRecoveredAt ? (
                            <>
                              {" | "}
                              <span className="font-semibold">Marked Recovered On:</span> {formatDate((loan as any).markedRecoveredAt)}
                            </>
                          ) : null}
                        </p>
                      ) : null}
                      {!isReturned && (
                        <p className="text-sm text-muted-foreground">
                          <span className="font-semibold">Remaining:</span>{" "}
                          <span className={remainingColor} data-testid={`text-remaining-${loan.id}`}>
                            {remainingDays !== null ? `${remainingDays} Day(s)` : "-"}
                          </span>
                        </p>
                      )}
                    </div>
                    {loan.status === "active" && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" data-testid={`button-actions-loan-${loan.id}`}>
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {remainingDays !== null && remainingDays >= 0 && (
                            <DropdownMenuItem onClick={() => extendLoan.mutate(loan.id)} disabled={extendLoan.isPending} data-testid={`button-extend-loan-${loan.id}`}>
                              <Clock className="w-4 h-4 mr-2" /> Extend Loan
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => { if (confirm("Mark this book as lost or stolen?")) markLost.mutate(loan.id); }} disabled={markLost.isPending} data-testid={`button-lost-loan-${loan.id}`}>
                            <XCircle className="h-3.5 w-3.5 mr-2" /> Mark Lost / Stolen
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
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

function DigitalResourcesTab({
  resources,
  subjects,
  isLoading,
}: {
  resources: LibraryResource[];
  subjects: Subject[];
  isLoading: boolean;
}) {
  const { toast } = useToast();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterSubject, setFilterSubject] = useState<string>("all");

  const createResource = useMutation({
    mutationFn: async (data: Partial<LibraryResource>) => apiRequest("POST", "/api/library/resources", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/library/resources"] });
      setIsAddOpen(false);
      toast({ title: "Resource added successfully" });
    },
    onError: () => toast({ title: "Failed to add resource", variant: "destructive" }),
  });

  const deleteResource = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/library/resources/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/library/resources"] });
      toast({ title: "Resource deleted" });
    },
    onError: () => toast({ title: "Failed to delete resource", variant: "destructive" }),
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const subjectIdVal = fd.get("subjectId") as string;
    createResource.mutate({
      title: fd.get("title") as string,
      description: fd.get("description") as string,
      fileType: fd.get("fileType") as string,
      fileUrl: fd.get("fileUrl") as string,
      subjectId: subjectIdVal ? parseInt(subjectIdVal) : undefined,
      category: fd.get("category") as string,
    });
  };

  const getTypeIcon = (fileType: string | null) => {
    switch (fileType) {
      case "book":
        return <BookOpen className="h-4 w-4" />;
      case "video":
        return <Video className="h-4 w-4" />;
      case "document":
        return <FileText className="h-4 w-4" />;
      default:
        return <LinkIcon className="h-4 w-4" />;
    }
  };

  const filteredResources = resources.filter((resource) => {
    const matchesSearch = resource.title.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = filterType === "all" || resource.fileType === filterType;
    const matchesSubject = filterSubject === "all" || resource.subjectId?.toString() === filterSubject;
    return matchesSearch && matchesType && matchesSubject;
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-3 flex-1 min-w-0 flex-wrap">
          <div className="relative w-full basis-full md:basis-auto md:flex-1 md:min-w-[260px] md:max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search resources..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
              data-testid="input-search-resources"
            />
          </div>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-full sm:w-[150px]" data-testid="select-filter-type">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="book">Books</SelectItem>
              <SelectItem value="video">Videos</SelectItem>
              <SelectItem value="document">Documents</SelectItem>
              <SelectItem value="link">Links</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterSubject} onValueChange={setFilterSubject}>
            <SelectTrigger className="w-full sm:w-[180px]" data-testid="select-filter-subject">
              <SelectValue placeholder="Subject" />
            </SelectTrigger>
            <SelectContent className="max-h-48 overflow-y-auto">
              <SelectItem value="all">All Subjects</SelectItem>
              {(Array.isArray(subjects) ? subjects : []).map((subject) => (
                <SelectItem key={subject.id} value={subject.id.toString()}>
                  {subject.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-resource">
              <Plus className="h-4 w-4 mr-2" />
              Add Resource
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Resource</DialogTitle>
              <DialogDescription>Upload a new learning resource to the library</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="res-title">Title</Label>
                <Input id="res-title" name="title" required data-testid="input-resource-title" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="res-description">Description</Label>
                <Textarea id="res-description" name="description" data-testid="input-resource-description" />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="res-fileType">Type</Label>
                  <Select name="fileType" defaultValue="document">
                    <SelectTrigger data-testid="select-resource-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="book">Book</SelectItem>
                      <SelectItem value="video">Video</SelectItem>
                      <SelectItem value="document">Document</SelectItem>
                      <SelectItem value="link">Link</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="res-category">Category</Label>
                  <Input id="res-category" name="category" placeholder="e.g., Form 1-4" data-testid="input-category" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="res-subjectId">Subject</Label>
                <Select name="subjectId">
                  <SelectTrigger data-testid="select-subject">
                    <SelectValue placeholder="Select subject" />
                  </SelectTrigger>
                  <SelectContent className="max-h-48 overflow-y-auto">
                    {(Array.isArray(subjects) ? subjects : []).map((subject) => (
                      <SelectItem key={subject.id} value={subject.id.toString()}>
                        {subject.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="res-fileUrl">Resource URL</Label>
                <Input id="res-fileUrl" name="fileUrl" type="url" placeholder="https://..." data-testid="input-resource-url" />
              </div>
              <Button type="submit" className="w-full" disabled={createResource.isPending} data-testid="button-submit-resource">
                Add Resource
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {filteredResources.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <BookOpen className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Resources Found</h3>
            <p className="text-muted-foreground text-center">
              {searchTerm || filterType !== "all" || filterSubject !== "all"
                ? "Try adjusting your filters"
                : "Add your first learning resource to get started"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredResources.map((resource) => (
            <Card key={resource.id} className="hover-elevate" data-testid={`card-resource-${resource.id}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {getTypeIcon(resource.fileType)}
                    <Badge variant="secondary">{resource.fileType || "other"}</Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteResource.mutate(resource.id)}
                    data-testid={`button-delete-resource-${resource.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <CardTitle className="text-lg mt-2">{resource.title}</CardTitle>
                <p className="text-sm text-muted-foreground">{resource.description || "No description"}</p>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  {resource.category && (
                    <Badge variant="outline">{resource.category}</Badge>
                  )}
                  {resource.fileUrl && (
                    <Button variant="outline" size="sm" asChild>
                      <a href={resource.fileUrl} target="_blank" rel="noopener noreferrer" data-testid={`link-resource-${resource.id}`}>
                        <Download className="h-4 w-4 mr-2" />
                        Access
                      </a>
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function FinesTab({
  fines,
  loans,
  finesLoading,
}: {
  fines: LibraryFine[];
  loans: LibraryLoan[];
  finesLoading: boolean;
}) {
  const { toast } = useToast();
  const [isAddFineOpen, setIsAddFineOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const createFine = useMutation({
    mutationFn: async (data: Record<string, unknown>) => apiRequest("POST", "/api/library/fines", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/library/fines"] });
      setIsAddFineOpen(false);
      toast({ title: "Fine added successfully" });
    },
    onError: () => toast({ title: "Failed to add fine", variant: "destructive" }),
  });

  const updateFine = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Record<string, unknown> }) =>
      apiRequest("PUT", `/api/library/fines/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/library/fines"] });
      toast({ title: "Fine updated" });
    },
    onError: () => toast({ title: "Failed to update fine", variant: "destructive" }),
  });

  const filteredFines = useMemo(() => {
    if (statusFilter === "all") return fines;
    return fines.filter((f) => f.status === statusFilter);
  }, [fines, statusFilter]);

  const { sortedData: sortedFines, sortConfig: finesSortConfig, requestSort: requestFinesSort } = useTableSort(filteredFines);

  const eligibleLoans = loans.filter((l) => l.status === "active" || l.status === "overdue");

  const getLoanBorrowerName = (loanId: number | null | undefined) => {
    if (!loanId) return "-";
    return loans.find((l) => l.id === loanId)?.borrowerName || "-";
  };

  const handleFineSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createFine.mutate({
      loanId: parseInt(fd.get("loanId") as string),
      amount: fd.get("amount") as string,
      reason: fd.get("reason") as string,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]" data-testid="select-fine-status-filter">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Fines</SelectItem>
            <SelectItem value="unpaid">Unpaid</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="waived">Waived</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={() => setIsAddFineOpen(true)} data-testid="button-add-fine">
          <Plus className="w-4 h-4 mr-2" /> Add Fine
        </Button>
      </div>

      <Dialog open={isAddFineOpen} onOpenChange={setIsAddFineOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Fine</DialogTitle>
            <DialogDescription>Create a fine for an active or overdue loan</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleFineSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Loan</Label>
              <Select name="loanId" required>
                <SelectTrigger data-testid="select-fine-loan">
                  <SelectValue placeholder="Select loan" />
                </SelectTrigger>
                <SelectContent>
                  {eligibleLoans.map((l) => (
                    <SelectItem key={l.id} value={l.id.toString()}>
                      Loan #{l.id} - {l.borrowerName || "Unknown"} ({l.status})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="fine-amount">Amount ($)</Label>
              <Input id="fine-amount" name="amount" type="number" step="0.01" min="0" required data-testid="input-fine-amount" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fine-reason">Reason</Label>
              <Input id="fine-reason" name="reason" required data-testid="input-fine-reason" />
            </div>
            <Button type="submit" className="w-full" disabled={createFine.isPending} data-testid="button-submit-fine">
              Add Fine
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent className="p-0">
          {finesLoading ? (
            <div className="space-y-3 p-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredFines.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <DollarSign className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Fines Found</h3>
              <p className="text-muted-foreground">
                {statusFilter !== "all" ? "Try changing the status filter" : "No fines have been recorded"}
              </p>
            </div>
          ) : (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTableHead sortKey="loanId" sortConfig={finesSortConfig} onSort={requestFinesSort}>Loan ID</SortableTableHead>
                    <SortableTableHead sortKey="borrowerName" sortConfig={finesSortConfig} onSort={requestFinesSort}>Borrower</SortableTableHead>
                    <SortableTableHead sortKey="amount" sortConfig={finesSortConfig} onSort={requestFinesSort}>Amount</SortableTableHead>
                    <SortableTableHead sortKey="reason" sortConfig={finesSortConfig} onSort={requestFinesSort}>Reason</SortableTableHead>
                    <SortableTableHead sortKey="status" sortConfig={finesSortConfig} onSort={requestFinesSort}>Status</SortableTableHead>
                    <SortableTableHead sortKey="createdAt" sortConfig={finesSortConfig} onSort={requestFinesSort}>Date</SortableTableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(sortedFines ?? []).map((fine) => (
                    <TableRow key={fine.id} data-testid={`row-fine-${fine.id}`}>
                      <TableCell>#{fine.loanId}</TableCell>
                      <TableCell>{getLoanBorrowerName(fine.loanId)}</TableCell>
                      <TableCell className="font-mono">${parseFloat(fine.amount).toFixed(2)}</TableCell>
                      <TableCell>{fine.reason || "-"}</TableCell>
                      <TableCell>{getFineStatusBadge(fine.status)}</TableCell>
                      <TableCell>{formatDate(fine.createdAt)}</TableCell>
                      <TableCell>
                        {fine.status === "unpaid" && (
                          <div className="flex items-center gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => updateFine.mutate({ id: fine.id, data: { status: "paid" } })}
                              disabled={updateFine.isPending}
                              data-testid={`button-pay-fine-${fine.id}`}
                            >
                              <CheckCircle2 className="w-3 h-3 mr-1" /> Mark Paid
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => updateFine.mutate({ id: fine.id, data: { status: "waived" } })}
                              disabled={updateFine.isPending}
                              data-testid={`button-waive-fine-${fine.id}`}
                            >
                              <Ban className="w-3 h-3 mr-1" /> Waive
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ReservationsTab({
  reservations,
  books,
  students,
  staff,
}: {
  reservations: LibraryReservation[];
  books: LibraryBook[];
  students: Student[];
  staff: Staff[];
}) {
  const [statusFilter, setStatusFilter] = useState("all");

  const updateReservation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Record<string, unknown> }) => {
      const res = await schoolFetch(`/api/library/reservations/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update reservation");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/library/reservations"] });
    },
  });

  const getBookTitle = (bookId: number | null) => {
    if (!bookId) return "-";
    return books.find(b => b.id === bookId)?.title || "-";
  };

  const getBorrowerName = (res: LibraryReservation) => {
    if (res.reserverType === "student" && res.reserverId) {
      const s = students.find(st => st.id === res.reserverId);
      return s ? `${s.firstName} ${s.lastName}` : `Student #${res.reserverId}`;
    }
    if (res.reserverType === "staff" && res.reserverId) {
      const st = staff.find(st => st.id === res.reserverId);
      return st ? `${st.firstName} ${st.lastName}` : `Staff #${res.reserverId}`;
    }
    return res.reserverName || "-";
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending": return <Badge variant="secondary">Pending</Badge>;
      case "ready": return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">Ready</Badge>;
      case "fulfilled": return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Fulfilled</Badge>;
      case "cancelled": return <Badge variant="outline">Cancelled</Badge>;
      case "expired": return <Badge variant="destructive">Expired</Badge>;
      default: return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const filtered = statusFilter === "all" ? reservations : reservations.filter(r => r.status === statusFilter);
  const defaultSorted = [...filtered].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  const { sortedData: sortedReservations, sortConfig: reservationsSortConfig, requestSort: requestReservationsSort } = useTableSort(defaultSorted);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-lg">Book Reservations</CardTitle>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px]" data-testid="select-reservation-filter">
              <SelectValue placeholder="Filter status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="ready">Ready</SelectItem>
              <SelectItem value="fulfilled">Fulfilled</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {(sortedReservations ?? []).length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No reservations found</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTableHead sortKey="bookId" sortConfig={reservationsSortConfig} onSort={requestReservationsSort}>Book</SortableTableHead>
                    <SortableTableHead sortKey="reserverName" sortConfig={reservationsSortConfig} onSort={requestReservationsSort}>Borrower</SortableTableHead>
                    <SortableTableHead sortKey="status" sortConfig={reservationsSortConfig} onSort={requestReservationsSort}>Status</SortableTableHead>
                    <SortableTableHead sortKey="createdAt" sortConfig={reservationsSortConfig} onSort={requestReservationsSort}>Reserved</SortableTableHead>
                    <SortableTableHead sortKey="expiresAt" sortConfig={reservationsSortConfig} onSort={requestReservationsSort}>Expires</SortableTableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(sortedReservations ?? []).map((resv) => (
                    <TableRow key={resv.id} data-testid={`row-reservation-${resv.id}`}>
                      <TableCell className="font-medium">{getBookTitle(resv.bookId)}</TableCell>
                      <TableCell>{getBorrowerName(resv)}</TableCell>
                      <TableCell>{getStatusBadge(resv.status || "pending")}</TableCell>
                      <TableCell>{formatDate(resv.createdAt)}</TableCell>
                      <TableCell>{formatDate(resv.expiresAt)}</TableCell>
                      <TableCell>
                        {resv.status === "pending" && (
                          <div className="flex items-center gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => updateReservation.mutate({ id: resv.id, data: { status: "ready" } })}
                              disabled={updateReservation.isPending}
                              data-testid={`button-ready-reservation-${resv.id}`}
                            >
                              <CheckCircle2 className="w-3 h-3 mr-1" /> Mark Ready
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => updateReservation.mutate({ id: resv.id, data: { status: "cancelled" } })}
                              disabled={updateReservation.isPending}
                              data-testid={`button-cancel-reservation-${resv.id}`}
                            >
                              <XCircle className="w-3 h-3 mr-1" /> Cancel
                            </Button>
                          </div>
                        )}
                        {resv.status === "ready" && (
                          <div className="flex items-center gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => updateReservation.mutate({ id: resv.id, data: { status: "fulfilled" } })}
                              disabled={updateReservation.isPending}
                              data-testid={`button-fulfill-reservation-${resv.id}`}
                            >
                              <CheckCircle2 className="w-3 h-3 mr-1" /> Fulfilled
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => updateReservation.mutate({ id: resv.id, data: { status: "cancelled" } })}
                              disabled={updateReservation.isPending}
                              data-testid={`button-cancel-reservation-${resv.id}`}
                            >
                              <XCircle className="w-3 h-3 mr-1" /> Cancel
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
