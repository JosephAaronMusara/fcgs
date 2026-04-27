import { useState, useRef, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, schoolFetch } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { useTableSort } from "@/hooks/use-table-sort";
import { SortableTableHead } from "@/components/sortable-table-head";
import {
  Plus, DollarSign, Upload, Search, Send, Printer,
  FileText, TrendingUp, AlertTriangle, CheckCircle2, Clock,
  Users, ChevronRight
} from "lucide-react";
import type { FeesPayment, Student } from "@shared/schema";

interface FeesSummaryStudent {
  id: number;
  name: string;
  admissionNo: string;
  classLabel: string;
  photo: string | null;
  total: number;
  paid: number;
  balance: number;
  maxBalance: number;
  feesStatus: string;
  hasParentContact: boolean;
}

function getStatusBadge(status: string) {
  switch (status) {
    case "fully_paid":
      return <Badge variant="default" data-testid="badge-fully-paid"><CheckCircle2 className="w-3 h-3 mr-1" /> Fully Paid</Badge>;
    case "up_to_date":
      return <Badge variant="secondary" data-testid="badge-up-to-date"><Clock className="w-3 h-3 mr-1" /> Up to Date</Badge>;
    case "in_arrears":
      return <Badge variant="destructive" data-testid="badge-in-arrears"><AlertTriangle className="w-3 h-3 mr-1" /> In Arrears</Badge>;
    default:
      return <Badge variant="outline" data-testid="badge-na">N/A</Badge>;
  }
}

function formatCurrency(amount: number) {
  return amount ? `$${amount.toFixed(2)}` : "-";
}

export default function FeesPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("overview");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [selectedStudent, setSelectedStudent] = useState<FeesSummaryStudent | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: feesSummary, isLoading: summaryLoading } = useQuery<FeesSummaryStudent[]>({
    queryKey: ["/api/fees/summary"],
  });

  const { data: payments, isLoading: paymentsLoading } = useQuery<FeesPayment[]>({
    queryKey: ["/api/fees"],
  });

  const { data: students } = useQuery<Student[]>({
    queryKey: ["/api/students"],
  });

  const importMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const res = await schoolFetch("/api/fees/import-csv", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Import failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/fees/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/students"] });
      setIsImportOpen(false);
      toast({
        title: "Import Complete",
        description: `${data.updated} student(s) updated. ${data.not_found} not matched.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Import Failed", description: error.message, variant: "destructive" });
    },
  });

  const notifyMutation = useMutation({
    mutationFn: async (studentIds: number[]) => {
      const res = await apiRequest("POST", "/api/fees/notify", { studentIds });
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Notifications Sent",
        description: `${data.sent} reminder(s) sent. ${data.missing} missing parent contact.`,
      });
      setSelectedIds(new Set());
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: Partial<FeesPayment>) => {
      const res = await apiRequest("POST", "/api/fees", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fees"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      setIsAddOpen(false);
      toast({ title: "Success", description: "Payment recorded successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const filteredStudents = useMemo(() => {
    if (!feesSummary) return [];
    if (!searchQuery.trim()) return feesSummary;
    const q = searchQuery.toLowerCase();
    return feesSummary.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.classLabel.toLowerCase().includes(q) ||
        s.admissionNo.toLowerCase().includes(q)
    );
  }, [feesSummary, searchQuery]);

  const stats = useMemo(() => {
    if (!feesSummary) return { fullyPaid: 0, upToDate: 0, inArrears: 0, totalBalance: 0, totalPaid: 0 };
    return {
      fullyPaid: feesSummary.filter((s) => s.feesStatus === "fully_paid").length,
      upToDate: feesSummary.filter((s) => s.feesStatus === "up_to_date").length,
      inArrears: feesSummary.filter((s) => s.feesStatus === "in_arrears").length,
      totalBalance: feesSummary.reduce((sum, s) => sum + s.balance, 0),
      totalPaid: feesSummary.reduce((sum, s) => sum + s.paid, 0),
    };
  }, [feesSummary]);

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(filteredStudents.map((s) => s.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleSelectOne = (id: number, checked: boolean) => {
    const newSet = new Set(selectedIds);
    if (checked) newSet.add(id);
    else newSet.delete(id);
    setSelectedIds(newSet);
  };

  const handleImportSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    importMutation.mutate(formData);
  };

  const handleNotifySelected = () => {
    if (selectedIds.size === 0) {
      toast({ title: "No Selection", description: "Please select students first.", variant: "destructive" });
      return;
    }
    notifyMutation.mutate(Array.from(selectedIds));
  };

  const handleNotifyOne = (studentId: number) => {
    notifyMutation.mutate([studentId]);
  };

  const handleRecordPayment = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = {
      studentId: parseInt(formData.get("studentId") as string),
      amount: formData.get("amount") as string,
      paymentDate: formData.get("paymentDate") as string,
      paymentMethod: (formData.get("paymentMethod") as string) || "cash",
      term: (formData.get("term") as string) || undefined,
      year: formData.get("year") ? parseInt(formData.get("year") as string) : undefined,
      receiptNo: (formData.get("receiptNo") as string) || undefined,
    };
    createMutation.mutate(data);
  };

  const handlePrint = (student: FeesSummaryStudent) => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    let statusLabel = "N/A";
    if (student.feesStatus === "fully_paid") statusLabel = "Fully Paid";
    else if (student.feesStatus === "up_to_date") statusLabel = "Up to Date";
    else if (student.feesStatus === "in_arrears") statusLabel = "In Arrears";

    printWindow.document.write(`
      <html><head><title>Fee Statement - ${student.name}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 40px; max-width: 600px; margin: 0 auto; }
        h1 { font-size: 20px; margin-bottom: 4px; }
        .info { color: #666; margin-bottom: 24px; }
        table { width: 100%; border-collapse: collapse; margin-top: 16px; }
        td, th { padding: 8px 12px; text-align: left; border-bottom: 1px solid #eee; }
        th { font-weight: 600; }
        .amount { text-align: right; }
        .status { margin-top: 16px; padding: 8px 16px; display: inline-block; border-radius: 4px;
          ${student.feesStatus === "fully_paid" ? "background: #dcfce7; color: #15803d;" : student.feesStatus === "up_to_date" ? "background: #dbeafe; color: #1d4ed8;" : "background: #fef2f2; color: #b91c1c;"}
        }
        .footer { margin-top: 32px; color: #999; font-size: 12px; }
      </style></head><body>
        <h1>Student Fee Statement</h1>
        <p class="info">${student.name} - ${student.classLabel} (${student.admissionNo})</p>
        <table>
          <tr><th>Description</th><th class="amount">Amount</th></tr>
          <tr><td>Total Term Fees</td><td class="amount">$${student.total.toFixed(2)}</td></tr>
          <tr><td>Paid So Far</td><td class="amount">$${student.paid.toFixed(2)}</td></tr>
          <tr><td><strong>Balance Due</strong></td><td class="amount"><strong>$${student.balance.toFixed(2)}</strong></td></tr>
          ${student.maxBalance > 0 ? `<tr><td>Max Allowed Balance</td><td class="amount">$${student.maxBalance.toFixed(2)}</td></tr>` : ""}
        </table>
        <div class="status">${statusLabel}</div>
        <p class="footer">Generated on ${new Date().toLocaleDateString()} | First Choice Group of Schools</p>
      </body></html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  const getStudentName = (studentId: number) => {
    const student = students?.find((s) => s.id === studentId);
    return student ? `${student.firstName} ${student.lastName}` : "-";
  };
  const getStudentAdmNo = (studentId: number) => {
    const student = students?.find((s) => s.id === studentId);
    return student?.admissionNo || "";
  };

  const { sortedData: sortedSummary, sortConfig: summarySortConfig, requestSort: requestSummarySort } = useTableSort(filteredStudents);
  const { sortedData: sortedPayments, sortConfig: paymentsSortConfig, requestSort: requestPaymentsSort } = useTableSort(payments);

  const totalCollected = payments?.reduce((sum, p) => sum + parseFloat(p.amount), 0) || 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <DollarSign className="h-8 w-8" style={{ color: "#1b2a5c" }} />
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl" style={{ color: "#1b2a5c" }} data-testid="text-fees-title">Student Payments</h1>
            <p className="text-muted-foreground">
              Upload the latest Excel fees (saved as CSV), update balances, and send SMS / email reminders.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Dialog open={isImportOpen} onOpenChange={setIsImportOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" data-testid="button-import-csv">
                <Upload className="w-4 h-4 mr-2" />
                Upload from CSV
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Upload / Update from Excel (CSV)</DialogTitle>
                <DialogDescription>
                  In Excel use File &rarr; Save As &rarr; CSV (Comma delimited), then upload that CSV here.
                  Required columns: <strong>Name</strong>, <strong>Balance</strong>.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleImportSubmit} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Term total fee amount</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      name="term_total_fee"
                      placeholder="e.g. 650.00"
                      required
                      data-testid="input-term-total-fee"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Maximum allowed balance for "Up to date"</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      name="term_max_balance"
                      placeholder="e.g. 100.00"
                      required
                      data-testid="input-term-max-balance"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>CSV file (from Excel)</Label>
                  <Input
                    ref={fileInputRef}
                    type="file"
                    name="fees_csv"
                    accept=".csv"
                    required
                    data-testid="input-csv-file"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={importMutation.isPending} data-testid="button-submit-import">
                  {importMutation.isPending ? "Uploading..." : "Upload / Update Balances"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
          <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-payment">
                <Plus className="w-4 h-4 mr-2" />
                Record Payment
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Record New Payment</DialogTitle>
                <DialogDescription>Enter payment details for a student.</DialogDescription>
              </DialogHeader>
              <PaymentForm
                onSubmit={handleRecordPayment}
                students={students || []}
                isLoading={createMutation.isPending}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <DollarSign className="w-4 h-4 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Collected</p>
                <p className="text-lg font-bold" data-testid="stat-total-collected">${stats.totalPaid.toFixed(2)}</p>
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
                <p className="text-xs text-muted-foreground">Outstanding</p>
                <p className="text-lg font-bold" data-testid="stat-total-balance">${stats.totalBalance.toFixed(2)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Fully Paid</p>
                <p className="text-lg font-bold" data-testid="stat-fully-paid">{stats.fullyPaid}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                <Clock className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Up to Date</p>
                <p className="text-lg font-bold" data-testid="stat-up-to-date">{stats.upToDate}</p>
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
                <p className="text-xs text-muted-foreground">In Arrears</p>
                <p className="text-lg font-bold" data-testid="stat-in-arrears">{stats.inArrears}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid h-auto w-full grid-cols-1 sm:grid-cols-2">
          <TabsTrigger value="overview" data-testid="tab-overview">
            <Users className="w-4 h-4 mr-1" /> Fees Overview
          </TabsTrigger>
          <TabsTrigger value="payments" data-testid="tab-payments">
            <FileText className="w-4 h-4 mr-1" /> Payment Records
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-3">
          <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="relative w-full flex-1 min-w-0 md:max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by student name or class..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
                data-testid="input-fees-search"
              />
            </div>
            <Button
              className="w-full md:w-auto"
              variant="outline"
              onClick={handleNotifySelected}
              disabled={selectedIds.size === 0 || notifyMutation.isPending}
              data-testid="button-notify-selected"
            >
              <Send className="w-4 h-4 mr-2" />
              {notifyMutation.isPending ? "Sending..." : `Notify Selected (${selectedIds.size})`}
            </Button>
          </div>

          <div className="flex flex-col gap-4 lg:flex-row">
            <Card className="flex-1 min-w-0">
              <CardContent className="p-0">
                {summaryLoading ? (
                  <div className="space-y-3 p-4">
                    {[1, 2, 3, 4].map((i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : (
                  <div className="overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[36px]">
                            <Checkbox
                              checked={filteredStudents.length > 0 && selectedIds.size === filteredStudents.length}
                              onCheckedChange={handleSelectAll}
                              data-testid="checkbox-select-all"
                            />
                          </TableHead>
                          <SortableTableHead sortKey="name" sortConfig={summarySortConfig} onSort={requestSummarySort}>Student</SortableTableHead>
                          <SortableTableHead sortKey="classLabel" sortConfig={summarySortConfig} onSort={requestSummarySort}>Class</SortableTableHead>
                          <SortableTableHead sortKey="feesStatus" sortConfig={summarySortConfig} onSort={requestSummarySort}>Status</SortableTableHead>
                          <SortableTableHead sortKey="total" sortConfig={summarySortConfig} onSort={requestSummarySort} className="text-right">Total Fees</SortableTableHead>
                          <SortableTableHead sortKey="paid" sortConfig={summarySortConfig} onSort={requestSummarySort} className="text-right">Paid So Far</SortableTableHead>
                          <SortableTableHead sortKey="balance" sortConfig={summarySortConfig} onSort={requestSummarySort} className="text-right">Balance Due</SortableTableHead>
                          <TableHead className="w-[100px]">Notify</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(sortedSummary ?? []).map((s) => (
                          <TableRow
                            key={s.id}
                            className={`cursor-pointer ${selectedStudent?.id === s.id ? "bg-muted/50" : ""}`}
                            onClick={() => setSelectedStudent(s)}
                            data-testid={`row-fee-student-${s.id}`}
                          >
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <Checkbox
                                checked={selectedIds.has(s.id)}
                                onCheckedChange={(checked) => handleSelectOne(s.id, !!checked)}
                                data-testid={`checkbox-student-${s.id}`}
                              />
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Avatar className="w-7 h-7">
                                  {s.photo && <AvatarImage src={s.photo} />}
                                  <AvatarFallback className="text-xs">
                                    {s.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                                  </AvatarFallback>
                                </Avatar>
                                <span className="font-medium text-sm">{s.name}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-sm">{s.classLabel}</TableCell>
                            <TableCell>{getStatusBadge(s.feesStatus)}</TableCell>
                            <TableCell className="text-right text-sm font-mono">{formatCurrency(s.total)}</TableCell>
                            <TableCell className="text-right text-sm font-mono">{formatCurrency(s.paid)}</TableCell>
                            <TableCell className="text-right text-sm font-mono font-semibold">
                              {formatCurrency(s.balance)}
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleNotifyOne(s.id)}
                                disabled={!s.hasParentContact || notifyMutation.isPending}
                                data-testid={`button-notify-${s.id}`}
                              >
                                <Send className="w-3 h-3 mr-1" /> Notify
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                        {filteredStudents.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                              No students found.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            {selectedStudent && (
              <Card className="w-full shrink-0 lg:w-[300px]">
                <CardContent className="pt-6">
                  <div className="flex flex-col items-center text-center mb-4">
                    <Avatar className="w-16 h-16 mb-3">
                      {selectedStudent.photo && <AvatarImage src={selectedStudent.photo} />}
                      <AvatarFallback className="text-lg">
                        {selectedStudent.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                      </AvatarFallback>
                    </Avatar>
                    <h3 className="font-semibold text-base" data-testid="detail-student-name">{selectedStudent.name}</h3>
                    <p className="text-sm text-muted-foreground">{selectedStudent.classLabel}</p>
                    <p className="text-xs text-muted-foreground font-mono mt-1">{selectedStudent.admissionNo}</p>
                  </div>

                  <div className="space-y-3">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground">Total Fees</span>
                      <span className="font-medium" data-testid="detail-total">${selectedStudent.total.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground">Paid So Far</span>
                      <span className="font-medium text-green-600 dark:text-green-400" data-testid="detail-paid">${selectedStudent.paid.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground">Balance Due</span>
                      <span className="font-bold" data-testid="detail-balance">${selectedStudent.balance.toFixed(2)}</span>
                    </div>
                    {selectedStudent.maxBalance > 0 && (
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-muted-foreground">Max Balance</span>
                        <span className="font-medium">${selectedStudent.maxBalance.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground">Status</span>
                      {getStatusBadge(selectedStudent.feesStatus)}
                    </div>
                  </div>

                  <div className="mt-5 space-y-2">
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => handlePrint(selectedStudent)}
                      data-testid="button-print-statement"
                    >
                      <Printer className="w-4 h-4 mr-2" /> Print / Download
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => handleNotifyOne(selectedStudent.id)}
                      disabled={!selectedStudent.hasParentContact || notifyMutation.isPending}
                      data-testid="button-notify-detail"
                    >
                      <Send className="w-4 h-4 mr-2" /> Send Reminder
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="payments" className="mt-3">
          <Card>
            <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-base">Recent Payments</CardTitle>
              <Badge variant="outline">
                <TrendingUp className="w-3 h-3 mr-1" />
                Total: ${totalCollected.toFixed(2)}
              </Badge>
            </CardHeader>
            <CardContent>
              {paymentsLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SortableTableHead sortKey="studentId" sortConfig={paymentsSortConfig} onSort={requestPaymentsSort}>Student</SortableTableHead>
                      <SortableTableHead sortKey="amount" sortConfig={paymentsSortConfig} onSort={requestPaymentsSort}>Amount</SortableTableHead>
                      <SortableTableHead sortKey="paymentDate" sortConfig={paymentsSortConfig} onSort={requestPaymentsSort}>Date</SortableTableHead>
                      <SortableTableHead sortKey="paymentMethod" sortConfig={paymentsSortConfig} onSort={requestPaymentsSort}>Method</SortableTableHead>
                      <SortableTableHead sortKey="term" sortConfig={paymentsSortConfig} onSort={requestPaymentsSort}>Term</SortableTableHead>
                      <SortableTableHead sortKey="receiptNo" sortConfig={paymentsSortConfig} onSort={requestPaymentsSort}>Receipt No</SortableTableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(sortedPayments ?? []).map((p) => (
                      <TableRow key={p.id} data-testid={`row-payment-${p.id}`}>
                        <TableCell>
                          <div>
                            <p className="font-medium text-sm">{getStudentName(p.studentId)}</p>
                            <p className="text-xs text-muted-foreground font-mono">{getStudentAdmNo(p.studentId)}</p>
                          </div>
                        </TableCell>
                        <TableCell className="font-bold text-green-600 dark:text-green-400">${p.amount}</TableCell>
                        <TableCell className="text-sm">{p.paymentDate}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize text-xs">{p.paymentMethod}</Badge>
                        </TableCell>
                        <TableCell className="text-sm">{p.term || "-"} {p.year || ""}</TableCell>
                        <TableCell className="text-sm">{p.receiptNo || "-"}</TableCell>
                      </TableRow>
                    ))}
                    {payments?.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          No payments recorded yet
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PaymentForm({
  onSubmit,
  students,
  isLoading,
}: {
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  students: Student[];
  isLoading: boolean;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="studentId">Student</Label>
        <Select name="studentId" required>
          <SelectTrigger data-testid="select-student">
            <SelectValue placeholder="Select student" />
          </SelectTrigger>
          <SelectContent>
            {students.map((s) => (
              <SelectItem key={s.id} value={s.id.toString()}>
                {s.firstName} {s.lastName} ({s.admissionNo})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="amount">Amount (USD)</Label>
          <Input
            id="amount"
            name="amount"
            type="number"
            step="0.01"
            placeholder="0.00"
            required
            data-testid="input-amount"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="paymentDate">Payment Date</Label>
          <Input
            id="paymentDate"
            name="paymentDate"
            type="date"
            defaultValue={new Date().toISOString().split("T")[0]}
            required
            data-testid="input-payment-date"
          />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="paymentMethod">Payment Method</Label>
          <Select name="paymentMethod" defaultValue="cash">
            <SelectTrigger data-testid="select-method">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cash">Cash</SelectItem>
              <SelectItem value="bank">Bank Transfer</SelectItem>
              <SelectItem value="mobile">Mobile Money</SelectItem>
              <SelectItem value="cheque">Cheque</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="receiptNo">Receipt No</Label>
          <Input
            id="receiptNo"
            name="receiptNo"
            placeholder="Optional"
            data-testid="input-receipt-no"
          />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="term">Term</Label>
          <Select name="term">
            <SelectTrigger data-testid="select-term">
              <SelectValue placeholder="Select term" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Term 1">Term 1</SelectItem>
              <SelectItem value="Term 2">Term 2</SelectItem>
              <SelectItem value="Term 3">Term 3</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="year">Year</Label>
          <Input
            id="year"
            name="year"
            type="number"
            defaultValue={new Date().getFullYear()}
            data-testid="input-year"
          />
        </div>
      </div>
      <Button type="submit" className="w-full" disabled={isLoading} data-testid="button-save-payment">
        {isLoading ? "Recording..." : "Record Payment"}
      </Button>
    </form>
  );
}
