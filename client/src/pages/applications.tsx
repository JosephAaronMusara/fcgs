import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FileUser, CheckCircle, XCircle, Clock, Eye, UserPlus, FileText } from "lucide-react";
import { useTableSort } from "@/hooks/use-table-sort";
import { SortableTableHead } from "@/components/sortable-table-head";
import type { StudentApplication } from "@shared/schema";

export default function ApplicationsPage() {
  const { toast } = useToast();
  const [selectedApp, setSelectedApp] = useState<StudentApplication | null>(null);

  const { data: applications = [], isLoading } = useQuery<StudentApplication[]>({
    queryKey: ["/api/applications"],
  });

  const updateApplication = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      return apiRequest("PUT", `/api/applications/${id}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/applications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/students"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      setSelectedApp(null);
      toast({ title: "Application updated" });
    },
    onError: () => {
      toast({ title: "Failed to update application", variant: "destructive" });
    },
  });

  const getGradeName = (grade: string | null) => {
    if (!grade) return "Not specified";
    return grade;
  };

  const formatDate = (date: string | Date | null) => {
    if (!date) return "-";
    return new Date(date).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "approved":
        return "default";
      case "rejected":
        return "destructive";
      default:
        return "secondary";
    }
  };

  const pendingApps = applications.filter(a => a.status === "pending");
  const approvedApps = applications.filter(a => a.status === "approved");
  const rejectedApps = applications.filter(a => a.status === "rejected");

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const ApplicationsTable = ({ apps }: { apps: StudentApplication[] }) => {
    const { sortedData, sortConfig, requestSort } = useTableSort(apps);
    return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortableTableHead sortKey="firstName" sortConfig={sortConfig} onSort={requestSort}>Student Name</SortableTableHead>
          <SortableTableHead sortKey="dateOfBirth" sortConfig={sortConfig} onSort={requestSort}>Date of Birth</SortableTableHead>
          <SortableTableHead sortKey="gradeApplyingFor" sortConfig={sortConfig} onSort={requestSort}>Grade Applied</SortableTableHead>
          <SortableTableHead sortKey="parentName" sortConfig={sortConfig} onSort={requestSort}>Parent</SortableTableHead>
          <SortableTableHead sortKey="createdAt" sortConfig={sortConfig} onSort={requestSort}>Applied On</SortableTableHead>
          <SortableTableHead sortKey="status" sortConfig={sortConfig} onSort={requestSort}>Status</SortableTableHead>
          <TableHead>Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {(sortedData ?? []).map((app) => (
          <TableRow key={app.id} data-testid={`row-application-${app.id}`}>
            <TableCell className="font-medium">
              {app.firstName} {app.lastName}
            </TableCell>
            <TableCell>{app.dateOfBirth}</TableCell>
            <TableCell>{getGradeName(app.gradeApplyingFor)}</TableCell>
            <TableCell>
              {app.parentName}
              <br />
              <span className="text-sm text-muted-foreground">{app.parentPhone}</span>
            </TableCell>
            <TableCell>{formatDate(app.createdAt!)}</TableCell>
            <TableCell>
              <Badge variant={getStatusColor(app.status || "pending")}>
                {app.status || "pending"}
              </Badge>
            </TableCell>
            <TableCell>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSelectedApp(app)}
                data-testid={`button-view-${app.id}`}
              >
                <Eye className="h-4 w-4" />
              </Button>
            </TableCell>
          </TableRow>
        ))}
        {apps.length === 0 && (
          <TableRow>
            <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
              No applications found
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <FileText className="h-8 w-8" style={{ color: "#1b2a5c" }} />
        <div>
          <h1 className="text-3xl font-bold tracking-tight" style={{ color: "#1b2a5c" }}>Student Applications</h1>
          <p className="text-muted-foreground">Review and manage enrollment applications</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Pending Review</p>
                <p className="text-2xl font-bold text-yellow-600">{pendingApps.length}</p>
              </div>
              <Clock className="h-8 w-8 text-yellow-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Approved</p>
                <p className="text-2xl font-bold text-green-600">{approvedApps.length}</p>
              </div>
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Rejected</p>
                <p className="text-2xl font-bold text-red-600">{rejectedApps.length}</p>
              </div>
              <XCircle className="h-8 w-8 text-red-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="pending" className="space-y-4">
        <TabsList data-testid="tabs-applications">
          <TabsTrigger value="pending" data-testid="tab-pending">
            Pending ({pendingApps.length})
          </TabsTrigger>
          <TabsTrigger value="approved" data-testid="tab-approved">
            Approved ({approvedApps.length})
          </TabsTrigger>
          <TabsTrigger value="rejected" data-testid="tab-rejected">
            Rejected ({rejectedApps.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          <Card>
            <CardHeader>
              <CardTitle>Pending Applications</CardTitle>
              <CardDescription>Applications awaiting review</CardDescription>
            </CardHeader>
            <CardContent>
              <ApplicationsTable apps={pendingApps} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="approved">
          <Card>
            <CardHeader>
              <CardTitle>Approved Applications</CardTitle>
              <CardDescription>Accepted students ready for enrollment</CardDescription>
            </CardHeader>
            <CardContent>
              <ApplicationsTable apps={approvedApps} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rejected">
          <Card>
            <CardHeader>
              <CardTitle>Rejected Applications</CardTitle>
              <CardDescription>Applications that were not accepted</CardDescription>
            </CardHeader>
            <CardContent>
              <ApplicationsTable apps={rejectedApps} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!selectedApp} onOpenChange={() => setSelectedApp(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Application Details</DialogTitle>
            <DialogDescription>
              Review application from {selectedApp?.firstName} {selectedApp?.lastName}
            </DialogDescription>
          </DialogHeader>
          {selectedApp && (
            <div className="space-y-6">
              <div className="grid gap-4 grid-cols-2">
                <div>
                  <h4 className="font-semibold mb-2">Student Information</h4>
                  <div className="space-y-1 text-sm">
                    <p><span className="text-muted-foreground">Name:</span> {selectedApp.firstName} {selectedApp.lastName}</p>
                    <p><span className="text-muted-foreground">Date of Birth:</span> {selectedApp.dateOfBirth || "-"}</p>
                    <p><span className="text-muted-foreground">Gender:</span> {selectedApp.gender || "-"}</p>
                    <p><span className="text-muted-foreground">Grade Applied:</span> {getGradeName(selectedApp.gradeApplyingFor)}</p>
                    <p><span className="text-muted-foreground">Religion:</span> {selectedApp.religion || "-"}</p>
                    <p><span className="text-muted-foreground">National ID / Birth Entry No:</span> {selectedApp.birthEntryNumber || "-"}</p>
                    <p><span className="text-muted-foreground">Dream Job:</span> {selectedApp.dreamJob || "-"}</p>
                    <p><span className="text-muted-foreground">Subjects of Interest:</span> {selectedApp.subjectsOfInterest || "-"}</p>
                    {selectedApp.expectedStartDate && (
                      <p><span className="text-muted-foreground">Expected Start:</span> {formatDate(selectedApp.expectedStartDate)}</p>
                    )}
                  </div>
                </div>
                <div>
                  <h4 className="font-semibold mb-2">Parent/Guardian Information</h4>
                  <div className="space-y-1 text-sm">
                    <p><span className="text-muted-foreground">Name:</span> {selectedApp.parentName}</p>
                    <p><span className="text-muted-foreground">Relationship:</span> {selectedApp.parentRelationship || "-"}</p>
                    <p><span className="text-muted-foreground">Email:</span> {selectedApp.parentEmail || "-"}</p>
                    <p><span className="text-muted-foreground">Phone:</span> {selectedApp.parentPhone}</p>
                  </div>
                  <h4 className="font-semibold mb-2 mt-4">Address</h4>
                  <div className="space-y-1 text-sm">
                    <p><span className="text-muted-foreground">Street:</span> {selectedApp.streetAddress || "-"}</p>
                    <p><span className="text-muted-foreground">Area:</span> {selectedApp.residentialArea || "-"}</p>
                    <p><span className="text-muted-foreground">City/Address:</span> {selectedApp.address || "-"}</p>
                  </div>
                </div>
              </div>

              {selectedApp.previousSchool && (
                <div>
                  <h4 className="font-semibold mb-2">Previous Education</h4>
                  <p className="text-sm">{selectedApp.previousSchool}</p>
                </div>
              )}

              {selectedApp.notes && (
                <div>
                  <h4 className="font-semibold mb-2">Additional Notes</h4>
                  <p className="text-sm">{selectedApp.notes}</p>
                </div>
              )}

              {selectedApp.status === "pending" && (
                <div className="flex gap-3 pt-4 border-t">
                  <Button
                    onClick={() => updateApplication.mutate({ id: selectedApp.id, status: "approved" })}
                    disabled={updateApplication.isPending}
                    data-testid="button-approve"
                  >
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Approve Application
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => updateApplication.mutate({ id: selectedApp.id, status: "rejected" })}
                    disabled={updateApplication.isPending}
                    data-testid="button-reject"
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Reject Application
                  </Button>
                </div>
              )}

              {selectedApp.status === "approved" && (
                <div className="flex gap-3 pt-4 border-t">
                  <Button data-testid="button-enroll">
                    <UserPlus className="h-4 w-4 mr-2" />
                    Enroll as Student
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
