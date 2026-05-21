import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { CheckCircle, Send, Loader2 } from "lucide-react";

interface PublicSchool {
  id: number;
  name: string;
  shortCode: string;
  schoolType: string;
  examinationBoard: string;
  isBoarding: boolean;
}

const PRIMARY_GRADES = [
  "ECD A", "ECD B", "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6", "Grade 7",
];

const SECONDARY_GRADES = [
  "Form 1", "Form 2", "Form 3", "Form 4", "Form 5", "Form 6",
];

interface ApplicationFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function ApplyPage() {
  const [open, setOpen] = useState(true);
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/10 via-background to-primary/5 p-4">
      <ApplicationFormModal open={open} onOpenChange={setOpen} />
      {!open && (
        <div className="text-center">
          <Button onClick={() => setOpen(true)} data-testid="button-reopen-form">
            Open Application Form
          </Button>
        </div>
      )}
    </div>
  );
}

export function ApplicationFormModal({ open, onOpenChange }: ApplicationFormModalProps) {
  const { toast } = useToast();
  const [submitted, setSubmitted] = useState(false);
  const [selectedSchoolId, setSelectedSchoolId] = useState<string>("");
  const [selectedGender, setSelectedGender] = useState<string>("");
  const [selectedRelationship, setSelectedRelationship] = useState<string>("");
  const [selectedGrade, setSelectedGrade] = useState<string>("");

  const { data: schools = [] } = useQuery<PublicSchool[]>({
    queryKey: ["/api/public/schools"],
  });

  const selectedSchool = schools.find(s => s.id.toString() === selectedSchoolId);
  const availableGrades = selectedSchool
    ? selectedSchool.schoolType === "primary"
      ? PRIMARY_GRADES
      : SECONDARY_GRADES
    : [];

  const handleSchoolChange = (value: string) => {
    setSelectedSchoolId(value);
    setSelectedGrade("");
  };

  const submitApplication = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      return apiRequest("POST", "/api/applications", data);
    },
    onSuccess: () => {
      setSubmitted(true);
      toast({ title: "Application submitted successfully" });
    },
    onError: () => {
      toast({ title: "Failed to submit application", variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    submitApplication.mutate({
      schoolId: selectedSchoolId ? parseInt(selectedSchoolId) : null,
      firstName: formData.get("firstName") as string,
      lastName: formData.get("lastName") as string,
      dateOfBirth: formData.get("dateOfBirth") as string || null,
      gender: selectedGender || null,
      gradeApplyingFor: selectedGrade || null,
      religion: formData.get("religion") as string || null,
      streetAddress: formData.get("streetAddress") as string || null,
      residentialArea: formData.get("residentialArea") as string || null,
      subjectsOfInterest: formData.get("subjectsOfInterest") as string || null,
      previousSchool: formData.get("previousSchool") as string || null,
      parentName: formData.get("parentName") as string,
      parentPhone: formData.get("parentPhone") as string,
      parentEmail: formData.get("parentEmail") as string || null,
      parentRelationship: selectedRelationship || null,
      address: formData.get("address") as string || null,
      nationalIdNumber: formData.get("nationalIdNumber") as string || null,
      dreamJob: formData.get("dreamJob") as string || null,
      expectedStartDate: formData.get("expectedStartDate") as string || null,
      notes: formData.get("notes") as string || null,
      status: "pending",
    });
  };

  const handleClose = () => {
    if (submitted) {
      setSubmitted(false);
      setSelectedSchoolId("");
      setSelectedGender("");
      setSelectedRelationship("");
      setSelectedGrade("");
    }
    onOpenChange(false);
  };

  if (submitted) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-md">
          <div className="pt-6 pb-4 text-center">
            <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-2" data-testid="text-application-success">Application Submitted!</h2>
            <p className="text-muted-foreground mb-6">
              Thank you for applying to First Choice Group of Schools. We will review your application and contact you soon.
            </p>
            <div className="flex gap-3 justify-center">
              <Button onClick={() => setSubmitted(false)} variant="outline" data-testid="button-new-application">
                Submit Another
              </Button>
              <Button onClick={handleClose} data-testid="button-close-success">
                Close
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
        <DialogHeader>
          <DialogTitle data-testid="text-application-title">Student Enrollment Application</DialogTitle>
          <DialogDescription>
            Please fill out all required fields to apply for enrollment at FCGS.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <h3 className="font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wide">School Selection</h3>
            <div className="space-y-2">
              <Label htmlFor="schoolId">Select School *</Label>
              <Select value={selectedSchoolId} onValueChange={handleSchoolChange} required>
                <SelectTrigger data-testid="select-school">
                  <SelectValue placeholder="Choose a school" />
                </SelectTrigger>
                <SelectContent>
                  {schools.map((school) => (
                    <SelectItem key={school.id} value={school.id.toString()}>
                      {school.name} ({school.examinationBoard}, {school.isBoarding ? "Boarding" : "Day"}, {school.schoolType === "primary" ? "Primary" : "Secondary"})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <h3 className="font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wide">Student Information</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name *</Label>
                <Input id="firstName" name="firstName" required data-testid="input-first-name" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name *</Label>
                <Input id="lastName" name="lastName" required data-testid="input-last-name" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dateOfBirth">Date of Birth</Label>
                <Input id="dateOfBirth" name="dateOfBirth" type="date" data-testid="input-dob" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="gender">Gender</Label>
                <Select value={selectedGender} onValueChange={setSelectedGender}>
                  <SelectTrigger data-testid="select-gender">
                    <SelectValue placeholder="Select gender" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="nationalIdNumber">National ID Number</Label>
                <Input id="nationalIdNumber" name="nationalIdNumber" placeholder="e.g. 00-000000A00" required data-testid="input-birth-entry" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="religion">Religion</Label>
                <Input id="religion" name="religion" placeholder="e.g. Christian, Muslim, etc." data-testid="input-religion" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="gradeApplyingFor">Level</Label>
                <Select value={selectedGrade} onValueChange={setSelectedGrade} disabled={!selectedSchoolId}>
                  <SelectTrigger data-testid="select-grade">
                    <SelectValue placeholder={!selectedSchoolId ? "Select a school first" : selectedSchool?.schoolType === "primary" ? "Select grade" : "Select form"} />
                  </SelectTrigger>
                  <SelectContent>
                    {availableGrades.map((grade) => (
                      <SelectItem key={grade} value={grade}>{grade}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="previousSchool">Previous School</Label>
                <Input id="previousSchool" name="previousSchool" placeholder="Name of previous school attended" data-testid="input-previous-school" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="expectedStartDate">Expected Start Date</Label>
                <Input id="expectedStartDate" name="expectedStartDate" type="date" data-testid="input-expected-start" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dreamJob">Dream Job / Career Aspiration</Label>
                <Input id="dreamJob" name="dreamJob" placeholder="What does the student want to be?" data-testid="input-dream-job" />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="subjectsOfInterest">Subjects of Interest</Label>
                <Input id="subjectsOfInterest" name="subjectsOfInterest" placeholder="e.g. Mathematics, Science, Art" data-testid="input-subjects" />
              </div>
            </div>
          </div>

          <div>
            <h3 className="font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wide">Address</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="streetAddress">Street Address</Label>
                <Input id="streetAddress" name="streetAddress" placeholder="House number & street" data-testid="input-street" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="residentialArea">Residential Area / Suburb</Label>
                <Input id="residentialArea" name="residentialArea" placeholder="e.g. Borrowdale, Mt Pleasant" data-testid="input-area" />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="address">City</Label>
                <Input id="address" name="address" placeholder="Full postal address" data-testid="input-address" />
              </div>
            </div>
          </div>

          <div>
            <h3 className="font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wide">Parent / Guardian Information</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="parentName">Full Name *</Label>
                <Input id="parentName" name="parentName" required data-testid="input-parent-name" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="parentRelationship">Relationship to Student</Label>
                <Select value={selectedRelationship} onValueChange={setSelectedRelationship}>
                  <SelectTrigger data-testid="select-relationship">
                    <SelectValue placeholder="Select relationship" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="father">Father</SelectItem>
                    <SelectItem value="mother">Mother</SelectItem>
                    <SelectItem value="guardian">Guardian</SelectItem>
                    <SelectItem value="uncle">Uncle</SelectItem>
                    <SelectItem value="aunt">Aunt</SelectItem>
                    <SelectItem value="grandparent">Grandparent</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="parentPhone">Phone Number *</Label>
                <Input id="parentPhone" name="parentPhone" type="tel" required data-testid="input-parent-phone" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="parentEmail">Email Address</Label>
                <Input id="parentEmail" name="parentEmail" type="email" data-testid="input-parent-email" />
              </div>
            </div>
          </div>

          <div>
            <h3 className="font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wide">Additional Information</h3>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="notes">Additional Notes</Label>
                <Textarea
                  id="notes"
                  name="notes"
                  placeholder="Any other information you'd like us to know (medical conditions, special needs, etc.)"
                  data-testid="input-notes"
                />
              </div>
            </div>
          </div>

          <div className="border-t pt-4">
            <Button
              type="submit"
              className="w-full"
              disabled={submitApplication.isPending}
              data-testid="button-submit-application"
            >
              {submitApplication.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Submit Application
                </>
              )}
            </Button>
            <p className="text-xs text-muted-foreground text-center mt-3">
              By submitting this application, you agree to our terms and conditions.
            </p>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}