import { useState, useMemo } from "react";
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
  LayoutDashboard,
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
  TrendingUp,
  BookMarked,
  ImagePlus,
  Settings,
  Upload,
  FileSpreadsheet,
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
  Subject,
  Student,
  Staff,
  Stream,
  Class,
} from "@shared/schema";

function formatDate(date: string | Date | null | undefined) {
  if (!date) return "-";
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getDefaultDueDate() {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toISOString().split("T")[0];
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

export default function LibraryPage() {
  const { toast } = useToast();

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
  const { data: subjects = [] } = useQuery<Subject[]>({
    queryKey: ["/api/subjects"],
  });
  const { data: classesList = [] } = useQuery<Class[]>({
    queryKey: ["/api/classes"],
  });
  const { data: streamsList = [] } = useQuery<Stream[]>({
    queryKey: ["/api/streams"],
  });
  const { data: studentsList = [] } = useQuery<Student[]>({
    queryKey: ["/api/students"],
  });
  const { data: staffList = [] } = useQuery<Staff[]>({
    queryKey: ["/api/staff"],
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Library className="h-8 w-8" style={{ color: "#1b2a5c" }} />
        <div>
          <h1 className="text-3xl font-bold tracking-tight" style={{ color: "#1b2a5c" }} data-testid="text-library-title">Library</h1>
          <p className="text-muted-foreground">Manage books, circulation, digital resources and fines</p>
        </div>
      </div>

      <Tabs defaultValue="dashboard">
        <TabsList>
          <TabsTrigger value="dashboard" data-testid="tab-dashboard">
            <LayoutDashboard className="h-4 w-4 mr-1" /> Dashboard
          </TabsTrigger>
          <TabsTrigger value="catalog" data-testid="tab-catalog">
            <BookOpen className="h-4 w-4 mr-1" /> Catalog
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

        <TabsContent value="dashboard" className="mt-4">
          <DashboardTab books={books} loans={loans} fines={fines} booksLoading={booksLoading} loansLoading={loansLoading} subjects={subjects} classes={classesList} streams={streamsList} />
        </TabsContent>
        <TabsContent value="catalog" className="mt-4">
          <CatalogTab books={books} categories={categories} subjects={subjects} classes={classesList} streams={streamsList} booksLoading={booksLoading} />
        </TabsContent>
        <TabsContent value="circulation" className="mt-4">
          <CirculationTab loans={loans} books={books} students={studentsList} staff={staffList} loansLoading={loansLoading} />
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
    </div>
  );
}

function DashboardTab({
  books,
  loans,
  fines,
  booksLoading,
  loansLoading,
  subjects,
  classes,
  streams,
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
  const [filterSubject, setFilterSubject] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");

  const totalBooks = books.length;
  const availableCopies = books.reduce((sum, b) => sum + (b.availableCopies || 0), 0);
  const activeLoans = loans.filter((l) => l.status === "active").length;
  const overdueLoans = loans.filter(
    (l) => l.status === "active" && l.dueDate && new Date(l.dueDate) < new Date()
  ).length + loans.filter((l) => l.status === "overdue").length;
  const unpaidFines = fines.filter((f) => f.status === "unpaid");
  const unpaidTotal = unpaidFines.reduce((sum, f) => sum + parseFloat(f.amount), 0);
  const paidFines = fines.filter((f) => f.status === "paid");
  const paidTotal = paidFines.reduce((sum, f) => sum + parseFloat(f.amount), 0);

  const getClassName = (classId: number | null | undefined) => {
    if (!classId) return "Unassigned";
    const cls = classes.find((c) => c.id === classId);
    return cls?.className || `Class #${classId}`;
  };

  const getStreamName = (classId: number | null | undefined) => {
    if (!classId) return "";
    const cls = classes.find((c) => c.id === classId);
    if (!cls?.streamId) return "";
    const stream = streams.find((s) => s.id === cls.streamId);
    return stream?.name || "";
  };

  const getSubjectName = (id: number | null | undefined) => {
    if (!id) return "";
    return (Array.isArray(subjects) ? subjects : []).find((s) => s.id === id)?.name || "";
  };

  const groupedBooks = useMemo(() => {
    let filtered = books;
    if (filterSubject !== "all") {
      filtered = filtered.filter((b) => b.subjectId?.toString() === filterSubject);
    }
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter((b) =>
        b.title.toLowerCase().includes(term) ||
        (b.author?.toLowerCase().includes(term) ?? false)
      );
    }

    const groups: Record<string, LibraryBook[]> = {};
    filtered.forEach((book) => {
      const key = book.title.toLowerCase().trim();
      if (!groups[key]) groups[key] = [];
      groups[key].push(book);
    });
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [books, filterSubject, searchTerm]);

  if (booksLoading || loansLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                <BookOpen className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Books</p>
                <p className="text-lg font-bold" data-testid="stat-total-books">{totalBooks}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <BookCopy className="w-4 h-4 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Available Copies</p>
                <p className="text-lg font-bold" data-testid="stat-available-copies">{availableCopies}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center">
                <Users className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Currently Borrowed</p>
                <p className="text-lg font-bold" data-testid="stat-borrowed">{activeLoans}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Overdue Books</p>
                <p className="text-lg font-bold" data-testid="stat-overdue">{overdueLoans}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
                <DollarSign className="w-4 h-4 text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Unpaid Fines</p>
                <p className="text-lg font-bold" data-testid="stat-unpaid-fines">
                  {unpaidFines.length} (${unpaidTotal.toFixed(2)})
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Paid Fines</p>
                <p className="text-lg font-bold" data-testid="stat-paid-fines">
                  {paidFines.length} (${paidTotal.toFixed(2)})
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search books..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
            data-testid="input-dashboard-search"
          />
        </div>
        <Select value={filterSubject} onValueChange={setFilterSubject}>
          <SelectTrigger className="w-[180px]" data-testid="select-dashboard-subject-filter">
            <SelectValue placeholder="Subject" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Subjects</SelectItem>
            {(Array.isArray(subjects) ? subjects : []).map((s) => (
              <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {groupedBooks.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <BookOpen className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Books Found</h3>
            <p className="text-muted-foreground">
              {searchTerm || filterSubject !== "all" ? "Try adjusting your filters" : "Add books from the Catalog tab to see them here"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {groupedBooks.map(([titleKey, booksInGroup]) => {
            const displayTitle = booksInGroup[0].title;
            const subjectName = getSubjectName(booksInGroup[0].subjectId);
            const author = booksInGroup[0].author;
            return (
              <div key={titleKey} className="space-y-3" data-testid={`group-book-${titleKey}`}>
                <div>
                  <h3 className="text-lg font-bold">{displayTitle}</h3>
                  <p className="text-sm text-muted-foreground">
                    {author && <span>by {author}</span>}
                    {author && subjectName && " | "}
                    {subjectName && <span>Subject: {subjectName}</span>}
                    {!author && !subjectName && "No additional details"}
                  </p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  {booksInGroup.map((book) => {
                    const borrowed = (book.totalCopies || 0) - (book.availableCopies || 0) - (book.damagedCopies || 0) - (book.lostStolenCopies || 0);
                    const className = getClassName(book.classId);
                    const streamName = getStreamName(book.classId);
                    return (
                      <Card key={book.id} data-testid={`card-dashboard-book-${book.id}`}>
                        <CardContent className="pt-3 pb-3 px-3 space-y-2">
                          <div className="text-center">
                            <p className="text-sm font-bold truncate" title={className}>{className}</p>
                            {streamName && <p className="text-xs text-muted-foreground truncate">{streamName}</p>}
                          </div>
                          <div className="space-y-1 text-xs">
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-muted-foreground">Available</span>
                              <span className="font-bold text-green-600 dark:text-green-400" data-testid={`text-dash-available-${book.id}`}>{book.availableCopies || 0}</span>
                            </div>
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-muted-foreground">Borrowed</span>
                              <span className="font-bold text-blue-600 dark:text-blue-400" data-testid={`text-dash-borrowed-${book.id}`}>{borrowed > 0 ? borrowed : 0}</span>
                            </div>
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-muted-foreground">Damaged</span>
                              <span className="font-bold text-red-600 dark:text-red-400" data-testid={`text-dash-damaged-${book.id}`}>{book.damagedCopies || 0}</span>
                            </div>
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-muted-foreground">Lost</span>
                              <span className="font-bold text-muted-foreground" data-testid={`text-dash-lost-${book.id}`}>{book.lostStolenCopies || 0}</span>
                            </div>
                          </div>
                          <div className="text-center pt-1 border-t">
                            <p className="text-xs text-muted-foreground">Total</p>
                            <p className="text-sm font-bold">{book.totalCopies || 0}</p>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            );
          })}
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
}: {
  books: LibraryBook[];
  categories: LibraryCategory[];
  subjects: Subject[];
  classes: Class[];
  streams: Stream[];
  booksLoading: boolean;
}) {
  const { toast } = useToast();
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
  const [addCopyBookId, setAddCopyBookId] = useState<number | null>(null);
  const [addCopyQrOpen, setAddCopyQrOpen] = useState(false);
  const [addCopyQrCode, setAddCopyQrCode] = useState("");
  const [addCopyCondition, setAddCopyCondition] = useState("Good");
  const [viewCopiesBookId, setViewCopiesBookId] = useState<number | null>(null);

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

  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [autoFillStream, setAutoFillStream] = useState("");
  const [autoFillShelf, setAutoFillShelf] = useState("");
  const [autoFillPubDate, setAutoFillPubDate] = useState("");

  const uploadCover = useMutation({
    mutationFn: async ({ bookId, file }: { bookId: number; file: File }) => {
      const fd = new FormData();
      fd.append("cover", file);
      const res = await schoolFetch(`/api/library/books/${bookId}/cover`, { method: "POST", body: fd });
      if (!res.ok) throw new Error("Failed to upload cover image");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/library/books"] });
    },
  });

  const handleBookSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data: Record<string, unknown> = {
      title: fd.get("title") as string,
      author: fd.get("author") as string || undefined,
      isbn: fd.get("isbn") as string || undefined,
      publisher: fd.get("publisher") as string || undefined,
      edition: fd.get("edition") as string || undefined,
      publishYear: fd.get("publishYear") ? parseInt(fd.get("publishYear") as string) : undefined,
      publicationDate: fd.get("publicationDate") as string || undefined,
      categoryId: fd.get("categoryId") ? parseInt(fd.get("categoryId") as string) : undefined,
      subjectId: fd.get("subjectId") ? parseInt(fd.get("subjectId") as string) : undefined,
      classId: fd.get("classId") ? parseInt(fd.get("classId") as string) : undefined,
      streamId: fd.get("streamId") ? parseInt(fd.get("streamId") as string) : undefined,
      description: fd.get("description") as string || undefined,
      totalCopies: parseInt(fd.get("totalCopies") as string) || 1,
      shelfLocation: fd.get("shelfLocation") as string || undefined,
    };
    if (editingBook) {
      updateBook.mutate({ id: editingBook.id, data });
      if (coverFile) uploadCover.mutate({ bookId: editingBook.id, file: coverFile });
    } else {
      createBook.mutate(data, {
        onSuccess: async (result: any) => {
          const newBook = await result.json?.() || result;
          if (coverFile && newBook?.id) {
            uploadCover.mutate({ bookId: newBook.id, file: coverFile });
          }
        },
      });
    }
    setCoverFile(null);
    setCoverPreview(null);
  };

  const handleTitleSuggestionSelect = (book: LibraryBook) => {
    setTitleSearch(book.title);
    setAutoFillAuthor(book.author || "");
    setAutoFillIsbn(book.isbn || "");
    setAutoFillPublisher(book.publisher || "");
    setAutoFillEdition(book.edition || "");
    setAutoFillYear(book.publishYear?.toString() || "");
    setAutoFillCategory(book.categoryId?.toString() || "");
    setAutoFillSubject(book.subjectId?.toString() || "");
    setAutoFillDescription(book.description || "");
    setAutoFillStream(book.streamId?.toString() || "");
    setAutoFillShelf(book.shelfLocation || "");
    setAutoFillPubDate(book.publicationDate || "");
    setShowTitleSuggestions(false);
  };

  const resetAutoFill = () => {
    setTitleSearch("");
    setAutoFillAuthor("");
    setAutoFillIsbn("");
    setAutoFillPublisher("");
    setAutoFillEdition("");
    setAutoFillYear("");
    setAutoFillCategory("");
    setAutoFillSubject("");
    setAutoFillDescription("");
    setAutoFillStream("");
    setAutoFillShelf("");
    setAutoFillPubDate("");
    setShowTitleSuggestions(false);
    setCoverFile(null);
    setCoverPreview(null);
  };

  const handleCategorySubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (editingCategory) {
      updateCategory.mutate({ id: editingCategory.id, data: { name: newCatName, description: newCatDesc || undefined } });
    } else {
      createCategory.mutate({ name: newCatName, description: newCatDesc || undefined });
    }
  };

  const shelfOptions = useMemo(() => {
    const shelves = new Set<string>();
    books.forEach(b => { if (b.shelfLocation) shelves.add(b.shelfLocation); });
    return Array.from(shelves).sort();
  }, [books]);

  const handleCoverSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setCoverFile(file);
      const reader = new FileReader();
      reader.onload = () => setCoverPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const bookFormDialog = (open: boolean, onOpenChange: (v: boolean) => void, book?: LibraryBook | null) => {
    const isEditing = !!book;
    const editCoverUrl = book?.coverImage || null;
    return (
      <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) resetAutoFill(); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
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
            <div className="grid grid-cols-2 gap-4">
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
            <div className="grid grid-cols-2 gap-4">
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
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold">
                  <span className="text-red-500">*</span> Subject
                </Label>
                {isEditing ? (
                  <Select name="subjectId" defaultValue={book?.subjectId?.toString() || ""}>
                    <SelectTrigger data-testid="select-book-subject">
                      <SelectValue placeholder="Select Subject" />
                    </SelectTrigger>
                    <SelectContent>
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
                    <SelectContent>
                      {(Array.isArray(subjects) ? subjects : []).map((s) => (
                        <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold">Book Shelf</Label>
                {isEditing ? (
                  <Select name="shelfLocation" defaultValue={book?.shelfLocation || ""}>
                    <SelectTrigger data-testid="select-book-shelf">
                      <SelectValue placeholder="Book Shelf" />
                    </SelectTrigger>
                    <SelectContent>
                      {shelfOptions.map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                      <SelectItem value="__custom">Other...</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Input id="shelfLocation" name="shelfLocation" placeholder="Book Shelf" value={autoFillShelf} onChange={(e) => setAutoFillShelf(e.target.value)} data-testid="input-book-shelf" />
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold">
                  <span className="text-red-500">*</span> Stream
                </Label>
                {isEditing ? (
                  <Select name="streamId" defaultValue={book?.streamId?.toString() || ""}>
                    <SelectTrigger data-testid="select-book-stream">
                      <SelectValue placeholder="Select stream" />
                    </SelectTrigger>
                    <SelectContent>
                      {streams.map((s) => (
                        <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Select name="streamId" value={autoFillStream} onValueChange={setAutoFillStream}>
                    <SelectTrigger data-testid="select-book-stream">
                      <SelectValue placeholder="Select stream" />
                    </SelectTrigger>
                    <SelectContent>
                      {streams.map((s) => (
                        <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="description" className="text-sm font-semibold">Description(Optional)</Label>
                {isEditing ? (
                  <Input id="description" name="description" placeholder="Enter book description" defaultValue={book?.description || ""} data-testid="input-book-description" />
                ) : (
                  <Input id="description" name="description" placeholder="Enter book description" value={autoFillDescription} onChange={(e) => setAutoFillDescription(e.target.value)} data-testid="input-book-description" />
                )}
              </div>
            </div>
            <input type="hidden" name="publishYear" value={isEditing ? (book?.publishYear || "") : autoFillYear} />
            <input type="hidden" name="categoryId" value={isEditing ? (book?.categoryId?.toString() || "") : autoFillCategory} />
            <input type="hidden" name="classId" value={book?.classId?.toString() || ""} />
            <input type="hidden" name="totalCopies" value={book?.totalCopies || 1} />
            <div className="space-y-1.5">
              <label
                htmlFor="cover-upload"
                className="flex flex-col items-center justify-center border-2 border-dashed rounded-md p-6 cursor-pointer hover-elevate transition-colors"
                data-testid="upload-cover-image"
              >
                {coverPreview || editCoverUrl ? (
                  <img
                    src={coverPreview || editCoverUrl || ""}
                    alt="Cover preview"
                    className="max-h-32 object-contain rounded-md mb-2"
                  />
                ) : (
                  <span className="text-sm text-muted-foreground">+ Upload book cover image</span>
                )}
                <input
                  id="cover-upload"
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
          <div className="relative flex-1 min-w-[200px] max-w-md">
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
            <SelectTrigger className="w-[180px]" data-testid="select-filter-category">
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
            <SelectTrigger className="w-[180px]" data-testid="select-catalog-subject-filter">
              <SelectValue placeholder="Subject" />
            </SelectTrigger>
            <SelectContent>
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
            <Download className="w-4 h-4 mr-2" /> Download Inventory List
          </Button>
          <Button variant="outline" onClick={() => setIsPolicyOpen(true)} data-testid="button-library-policy">
            <Settings className="w-4 h-4 mr-2" /> Policy
          </Button>
          <Button variant="outline" onClick={() => { setIsImportOpen(true); setImportResult(null); }} data-testid="button-import-books">
            <FileSpreadsheet className="w-4 h-4 mr-2" /> Upload
          </Button>
          <Button variant="outline" onClick={() => setIsCategoriesOpen(true)} data-testid="button-manage-categories">
            <Tag className="w-4 h-4 mr-2" /> Manage Categories
          </Button>
          <Button onClick={() => setIsAddBookOpen(true)} data-testid="button-add-book">
            <Plus className="w-4 h-4 mr-2" /> Add Book
          </Button>
        </div>
      </div>

      {bookFormDialog(isAddBookOpen, setIsAddBookOpen)}
      {bookFormDialog(editingBook !== null, (v) => !v && setEditingBook(null), editingBook)}

      <Dialog open={isCategoriesOpen} onOpenChange={setIsCategoriesOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Manage Categories</DialogTitle>
            <DialogDescription>Add, edit, or remove book categories</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCategorySubmit} className="space-y-3">
            <div className="flex gap-2">
              <Input
                placeholder="Category name"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                required
                data-testid="input-category-name"
              />
              <Input
                placeholder="Description (optional)"
                value={newCatDesc}
                onChange={(e) => setNewCatDesc(e.target.value)}
                data-testid="input-category-description"
              />
              <Button type="submit" disabled={createCategory.isPending || updateCategory.isPending} data-testid="button-submit-category">
                {editingCategory ? "Update" : "Add"}
              </Button>
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

      <Dialog open={isPolicyOpen} onOpenChange={setIsPolicyOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">LIBRARY POLICY</DialogTitle>
            <DialogDescription>Configure borrowing and notification policies</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              savePolicy.mutate({
                bookOverdueSmsAlert: fd.get("bookOverdueSmsAlert") === "true",
                maxBooksStudent: parseInt(fd.get("maxBooksStudent") as string) || 1,
                maxBooksTeacher: parseInt(fd.get("maxBooksTeacher") as string) || 500,
                overdueChargePerDay: fd.get("overdueChargePerDay") as string || "0.50",
                defaultBorrowDays: parseInt(fd.get("defaultBorrowDays") as string) || 1,
                smsAlertWindowDays: parseInt(fd.get("smsAlertWindowDays") as string) || 1,
              });
            }}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold">
                  <span className="text-red-500">*</span> Book overdue SMS alert
                </Label>
                <div className="flex gap-1">
                  <label className="flex-1">
                    <input type="radio" name="bookOverdueSmsAlert" value="true" defaultChecked={libraryPolicy?.bookOverdueSmsAlert !== false} className="peer sr-only" />
                    <div className="border rounded-md px-3 py-2 text-center text-sm cursor-pointer peer-checked:border-primary peer-checked:text-primary peer-checked:font-semibold" data-testid="radio-sms-alert-on">
                      Send Alert
                    </div>
                  </label>
                  <label className="flex-1">
                    <input type="radio" name="bookOverdueSmsAlert" value="false" defaultChecked={libraryPolicy?.bookOverdueSmsAlert === false} className="peer sr-only" />
                    <div className="border rounded-md px-3 py-2 text-center text-sm cursor-pointer peer-checked:border-primary peer-checked:text-primary peer-checked:font-semibold" data-testid="radio-sms-alert-off">
                      Don't send
                    </div>
                  </label>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="maxBooksStudent" className="text-sm font-semibold">
                  <span className="text-red-500">*</span> Max Books Student can Borrow
                </Label>
                <Input
                  id="maxBooksStudent"
                  name="maxBooksStudent"
                  type="number"
                  min="1"
                  defaultValue={libraryPolicy?.maxBooksStudent ?? 1}
                  data-testid="input-max-books-student"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="maxBooksTeacher" className="text-sm font-semibold">
                  <span className="text-red-500">*</span> Max Books Teacher can Borrow
                </Label>
                <Input
                  id="maxBooksTeacher"
                  name="maxBooksTeacher"
                  type="number"
                  min="1"
                  defaultValue={libraryPolicy?.maxBooksTeacher ?? 500}
                  data-testid="input-max-books-teacher"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="overdueChargePerDay" className="text-sm font-semibold">
                  <span className="text-red-500">*</span> Overdue Charge Per Day
                </Label>
                <Input
                  id="overdueChargePerDay"
                  name="overdueChargePerDay"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={libraryPolicy?.overdueChargePerDay ?? "0.50"}
                  data-testid="input-overdue-charge"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="defaultBorrowDays" className="text-sm font-semibold">
                  <span className="text-red-500">*</span> Default Number of Borrow Days
                </Label>
                <Input
                  id="defaultBorrowDays"
                  name="defaultBorrowDays"
                  type="number"
                  min="1"
                  defaultValue={libraryPolicy?.defaultBorrowDays ?? 1}
                  data-testid="input-borrow-days"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="smsAlertWindowDays" className="text-sm font-semibold">
                  <span className="text-red-500">*</span> SMS Alert Window (Days)
                </Label>
                <Input
                  id="smsAlertWindowDays"
                  name="smsAlertWindowDays"
                  type="number"
                  min="1"
                  defaultValue={libraryPolicy?.smsAlertWindowDays ?? 1}
                  data-testid="input-sms-alert-days"
                />
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <Button type="submit" disabled={savePolicy.isPending} data-testid="button-submit-policy">
                {savePolicy.isPending ? "Saving..." : "Submit"}
              </Button>
            </div>
          </form>
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
                  <p className="text-xs text-muted-foreground">{(importFile.size / 1024).toFixed(1)} KB</p>
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
        <CardContent className="p-0">
          {booksLoading ? (
            <div className="space-y-3 p-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
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
            <div className="divide-y">
              {filteredBooks.map((book) => {
                const borrowed = (book.totalCopies || 0) - (book.availableCopies || 0) - (book.damagedCopies || 0) - (book.lostStolenCopies || 0);
                return (
                  <div key={book.id} className="flex items-start justify-between gap-3 p-4" data-testid={`row-book-${book.id}`}>
                    {book.coverImage && (
                      <img src={book.coverImage} alt={book.title} className="w-12 h-16 object-cover rounded-md flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0 space-y-1">
                      <p className="text-base font-bold" data-testid={`text-book-title-${book.id}`}>{book.title}</p>
                      <p className="text-sm text-muted-foreground">
                        <span className="font-semibold">ISBN:</span> {book.isbn || "-"} | <span className="font-semibold">Author:</span> {book.author || "-"}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        <span className="font-semibold">Subject:</span> {getSubjectName(book.subjectId)} | <span className="font-semibold">Stream:</span> {book.streamId ? (streams.find(s => s.id === book.streamId)?.name || "-") : "-"} | <span className="font-semibold">Shelf:</span> {book.shelfLocation || "-"}
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
                          <BookCopy className="w-4 h-4 mr-2" /> Add Copy
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setViewCopiesBookId(book.id)}
                          data-testid={`button-view-copies-${book.id}`}
                        >
                          <Search className="w-4 h-4 mr-2" /> View Copies ({book.totalCopies || 0})
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setEditingBook(book)} data-testid={`button-edit-book-${book.id}`}>
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

      <Dialog open={!!addCopyBookId} onOpenChange={(open) => { if (!open) setAddCopyBookId(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Book Copy</DialogTitle>
            <DialogDescription>
              Scan or enter a QR code to register a new physical copy of "{books.find(b => b.id === addCopyBookId)?.title}"
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>QR Code</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="Enter QR code or scan..."
                  value={addCopyQrCode}
                  onChange={(e) => setAddCopyQrCode(e.target.value)}
                  data-testid="input-copy-qr"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setAddCopyQrOpen(true)}
                  data-testid="button-scan-qr"
                >
                  <Camera className="w-4 h-4" />
                </Button>
              </div>
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
                </SelectContent>
              </Select>
            </div>
            <Button
              className="w-full"
              disabled={!addCopyQrCode.trim() || addCopy.isPending}
              onClick={() => {
                if (addCopyBookId && addCopyQrCode.trim()) {
                  addCopy.mutate({ bookId: addCopyBookId, qrCode: addCopyQrCode.trim(), condition: addCopyCondition });
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
        onScan={(code) => setAddCopyQrCode(code)}
        title="Scan Book QR Code"
        description="Point your camera at the QR sticker on the book"
      />

      <Dialog open={!!viewCopiesBookId} onOpenChange={(open) => { if (!open) setViewCopiesBookId(null); }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
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
                  <TableHead>Added</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bookCopies.map((copy) => (
                  <TableRow key={copy.id} data-testid={`row-copy-${copy.id}`}>
                    <TableCell className="font-mono text-sm" data-testid={`text-copy-qr-${copy.id}`}>{copy.qrCode}</TableCell>
                    <TableCell>
                      <Badge
                        variant={copy.status === "available" ? "default" : copy.status === "borrowed" ? "secondary" : "destructive"}
                        data-testid={`badge-copy-status-${copy.id}`}
                      >
                        {copy.status}
                      </Badge>
                    </TableCell>
                    <TableCell data-testid={`text-copy-condition-${copy.id}`}>{copy.condition || "-"}</TableCell>
                    <TableCell>{formatDate(copy.addedAt)}</TableCell>
                    <TableCell>
                      {copy.status === "available" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            if (confirm("Remove this copy?")) deleteCopy.mutate(copy.id);
                          }}
                          data-testid={`button-delete-copy-${copy.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
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
  students,
  staff,
  loansLoading,
}: {
  loans: LibraryLoan[];
  books: LibraryBook[];
  students: Student[];
  staff: Staff[];
  loansLoading: boolean;
}) {
  const { toast } = useToast();
  const [isIssueOpen, setIsIssueOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [borrowerType, setBorrowerType] = useState<string>("student");
  const [borrowerSearch, setBorrowerSearch] = useState("");
  const [bookSearch, setBookSearch] = useState("");
  const [loanSearchTerm, setLoanSearchTerm] = useState("");
  const [scanReturnOpen, setScanReturnOpen] = useState(false);
  const [scannedBookInfo, setScannedBookInfo] = useState<{ copy: any; book: any; activeLoan: any } | null>(null);

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
      setScannedBookInfo(data);
    },
    onError: (error: Error) => toast({ title: error.message, variant: "destructive" }),
  });

  const issueLoan = useMutation({
    mutationFn: async (data: Record<string, unknown>) => apiRequest("POST", "/api/library/loans", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/library/loans"] });
      queryClient.invalidateQueries({ queryKey: ["/api/library/books"] });
      setIsIssueOpen(false);
      toast({ title: "Book issued successfully" });
    },
    onError: () => toast({ title: "Failed to issue book", variant: "destructive" }),
  });

  const returnLoan = useMutation({
    mutationFn: async (id: number) => apiRequest("PUT", `/api/library/loans/${id}/return`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/library/loans"] });
      queryClient.invalidateQueries({ queryKey: ["/api/library/books"] });
      toast({ title: "Book returned successfully" });
    },
    onError: () => toast({ title: "Failed to return book", variant: "destructive" }),
  });

  const markLost = useMutation({
    mutationFn: async (id: number) => apiRequest("PUT", `/api/library/loans/${id}/lost`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/library/loans"] });
      queryClient.invalidateQueries({ queryKey: ["/api/library/books"] });
      toast({ title: "Book marked as lost" });
    },
    onError: () => toast({ title: "Failed to mark book as lost", variant: "destructive" }),
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
  }, [loans, statusFilter, loanSearchTerm]);

  const availableBooks = books.filter((b) => (b.availableCopies || 0) > 0);
  const filteredAvailableBooks = availableBooks.filter((b) =>
    b.title.toLowerCase().includes(bookSearch.toLowerCase())
  );

  const borrowerOptions = borrowerType === "student"
    ? students.filter((s) => `${s.firstName} ${s.lastName}`.toLowerCase().includes(borrowerSearch.toLowerCase()))
    : staff.filter((s) => `${s.firstName} ${s.lastName}`.toLowerCase().includes(borrowerSearch.toLowerCase()));

  const handleIssueSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const borrowerId = parseInt(fd.get("borrowerId") as string);
    const selectedBorrower = borrowerType === "student"
      ? students.find((s) => s.id === borrowerId)
      : staff.find((s) => s.id === borrowerId);
    const borrowerName = selectedBorrower
      ? `${selectedBorrower.firstName} ${selectedBorrower.lastName}`
      : "";

    issueLoan.mutate({
      bookId: parseInt(fd.get("bookId") as string),
      borrowerType,
      borrowerId,
      borrowerName,
      dueDate: fd.get("dueDate") as string,
      conditionOnBorrow: fd.get("conditionOnBorrow") as string || "Good",
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-3 flex-1 min-w-0 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-md">
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
            <SelectTrigger className="w-[180px]" data-testid="select-loan-status-filter">
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
          <Button variant="outline" onClick={() => setScanReturnOpen(true)} data-testid="button-scan-qr-return">
            <Camera className="w-4 h-4 mr-2" /> Scan QR
          </Button>
          <Button onClick={() => setIsIssueOpen(true)} data-testid="button-issue-book">
            <Plus className="w-4 h-4 mr-2" /> Issue Book
          </Button>
        </div>
      </div>

      <QrScannerDialog
        open={scanReturnOpen}
        onOpenChange={(open) => {
          setScanReturnOpen(open);
          if (!open) setScannedBookInfo(null);
        }}
        onScan={(code) => {
          setScanReturnOpen(false);
          lookupQr.mutate(code);
        }}
        title="Scan Book QR Code"
        description="Scan a book's QR code to look up its loan status"
      />

      <Dialog open={!!scannedBookInfo} onOpenChange={(open) => { if (!open) setScannedBookInfo(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Scanned Book</DialogTitle>
            <DialogDescription>QR code lookup result</DialogDescription>
          </DialogHeader>
          {scannedBookInfo && (
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-sm"><span className="font-semibold">Title:</span> {scannedBookInfo.book?.title}</p>
                <p className="text-sm"><span className="font-semibold">QR Code:</span> <span className="font-mono">{scannedBookInfo.copy?.qrCode}</span></p>
                <p className="text-sm"><span className="font-semibold">Copy Status:</span>{" "}
                  <Badge variant={scannedBookInfo.copy?.status === "available" ? "default" : scannedBookInfo.copy?.status === "borrowed" ? "secondary" : "destructive"}>
                    {scannedBookInfo.copy?.status}
                  </Badge>
                </p>
                <p className="text-sm"><span className="font-semibold">Condition:</span> {scannedBookInfo.copy?.condition || "-"}</p>
              </div>
              {scannedBookInfo.copy?.status === "borrowed" && scannedBookInfo.activeLoan ? (
                <div className="space-y-2 border-t pt-3">
                  <p className="text-sm font-semibold">Active Loan</p>
                  <p className="text-sm"><span className="font-semibold">Borrower:</span> {scannedBookInfo.activeLoan.borrowerName}</p>
                  <p className="text-sm"><span className="font-semibold">Due:</span> {formatDate(scannedBookInfo.activeLoan.dueDate)}</p>
                  <Button
                    className="w-full"
                    onClick={() => {
                      returnLoan.mutate(scannedBookInfo.activeLoan.id);
                      setScannedBookInfo(null);
                    }}
                    data-testid="button-qr-return"
                  >
                    <RotateCcw className="w-4 h-4 mr-2" /> Return This Book
                  </Button>
                </div>
              ) : scannedBookInfo.copy?.status === "borrowed" ? (
                <p className="text-sm text-muted-foreground">No matching active loan found for this copy.</p>
              ) : null}
              {scannedBookInfo.copy?.status === "available" && (
                <p className="text-sm text-muted-foreground">This copy is currently available and not on loan.</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={isIssueOpen} onOpenChange={setIsIssueOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Issue Book</DialogTitle>
            <DialogDescription>Lend a book to a student or staff member</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleIssueSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Book</Label>
              <Input
                placeholder="Search available books..."
                value={bookSearch}
                onChange={(e) => setBookSearch(e.target.value)}
                data-testid="input-search-available-books"
              />
              <Select name="bookId" required>
                <SelectTrigger data-testid="select-loan-book">
                  <SelectValue placeholder="Select a book" />
                </SelectTrigger>
                <SelectContent>
                  {filteredAvailableBooks.map((b) => (
                    <SelectItem key={b.id} value={b.id.toString()}>
                      {b.title} ({b.availableCopies} available)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Borrower Type</Label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="borrowerTypeRadio"
                    value="student"
                    checked={borrowerType === "student"}
                    onChange={() => { setBorrowerType("student"); setBorrowerSearch(""); }}
                    data-testid="radio-borrower-student"
                  />
                  <span>Student</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="borrowerTypeRadio"
                    value="staff"
                    checked={borrowerType === "staff"}
                    onChange={() => { setBorrowerType("staff"); setBorrowerSearch(""); }}
                    data-testid="radio-borrower-staff"
                  />
                  <span>Staff</span>
                </label>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Borrower</Label>
              <Input
                placeholder={`Search ${borrowerType}...`}
                value={borrowerSearch}
                onChange={(e) => setBorrowerSearch(e.target.value)}
                data-testid="input-search-borrower"
              />
              <Select name="borrowerId" required>
                <SelectTrigger data-testid="select-loan-borrower">
                  <SelectValue placeholder={`Select ${borrowerType}`} />
                </SelectTrigger>
                <SelectContent>
                  {borrowerOptions.map((b) => (
                    <SelectItem key={b.id} value={b.id.toString()}>
                      {b.firstName} {b.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="dueDate">Due Date</Label>
              <Input id="dueDate" name="dueDate" type="date" defaultValue={getDefaultDueDate()} required data-testid="input-due-date" />
            </div>
            <div className="space-y-2">
              <Label>Condition on Borrow</Label>
              <Select name="conditionOnBorrow" defaultValue="Good">
                <SelectTrigger data-testid="select-condition-on-borrow">
                  <SelectValue placeholder="Select condition" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Good">Good</SelectItem>
                  <SelectItem value="Fair">Fair</SelectItem>
                  <SelectItem value="Poor">Poor</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" className="w-full" disabled={issueLoan.isPending} data-testid="button-submit-issue">
              Issue Book
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
            <div className="divide-y">
              {filteredLoans.map((loan) => {
                const conditionValue = loan.conditionOnBorrow || "-";
                const conditionDisplay = conditionValue !== "-" ? conditionValue.charAt(0).toUpperCase() + conditionValue.slice(1) : "-";
                const now = new Date();
                const dueDate = loan.dueDate ? new Date(loan.dueDate) : null;
                const remainingDays = dueDate ? Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null;
                const isReturned = loan.status === "returned";

                let remainingColor = "text-green-600 dark:text-green-400 font-bold";
                if (remainingDays !== null && remainingDays < 0) {
                  remainingColor = "text-red-600 dark:text-red-400 font-bold";
                } else if (remainingDays !== null && remainingDays <= 3) {
                  remainingColor = "text-orange-500 dark:text-yellow-400 font-bold";
                }

                return (
                  <div key={loan.id} className="flex items-start justify-between gap-3 p-4" data-testid={`row-loan-${loan.id}`}>
                    <div className="flex-1 min-w-0 space-y-1">
                      <p className="text-base font-bold" data-testid={`text-borrower-name-${loan.id}`}>
                        {loan.borrowerName || "-"} <span className="text-sm font-normal text-muted-foreground">({loan.borrowerType === "student" ? "Student" : "Staff"})</span>
                      </p>
                      <p className="text-sm text-muted-foreground">
                        <span className="font-semibold">Book:</span> {getBookTitle(loan.bookId)}
                      </p>
                      <p className="text-sm">
                        <span className="font-semibold">Status On Borrow:</span>{" "}
                        <span className="text-green-600 dark:text-green-400">{conditionDisplay}</span>
                      </p>
                      <p className="text-sm text-muted-foreground">
                        <span className="font-semibold">Issued On:</span> {formatDate(loan.issuedAt)} | <span className="font-semibold">Return Date:</span> {formatDate(loan.dueDate)}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        <span className="font-semibold">Returned On:</span>{" "}
                        {isReturned ? (
                          formatDate(loan.returnedAt)
                        ) : (
                          <span className="italic text-muted-foreground">Not returned</span>
                        )}
                        {" | "}
                        {isReturned ? (
                          <span><span className="font-semibold">Returned:</span> {formatDate(loan.returnedAt)}</span>
                        ) : (
                          <span>
                            <span className="font-semibold">Remaining:</span>{" "}
                            <span className={remainingColor} data-testid={`text-remaining-${loan.id}`}>
                              {remainingDays !== null ? `${remainingDays} Day(s)` : "-"}
                            </span>
                          </span>
                        )}
                      </p>
                    </div>
                    {loan.status === "active" && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" data-testid={`button-actions-loan-${loan.id}`}>
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => returnLoan.mutate(loan.id)}
                            disabled={returnLoan.isPending}
                            data-testid={`button-return-loan-${loan.id}`}
                          >
                            <RotateCcw className="w-4 h-4 mr-2" /> Return
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              if (confirm("Mark this book as lost?")) {
                                markLost.mutate(loan.id);
                              }
                            }}
                            disabled={markLost.isPending}
                            data-testid={`button-lost-loan-${loan.id}`}
                          >
                            <XCircle className="w-4 h-4 mr-2" /> Mark Lost
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
          <div className="relative flex-1 min-w-[200px]">
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
            <SelectTrigger className="w-[150px]" data-testid="select-filter-type">
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
            <SelectTrigger className="w-[180px]" data-testid="select-filter-subject">
              <SelectValue placeholder="Subject" />
            </SelectTrigger>
            <SelectContent>
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
              <div className="grid gap-4 grid-cols-2">
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
                  <SelectContent>
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
