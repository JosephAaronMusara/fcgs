import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest, schoolFetch } from "@/lib/queryClient";
import {
  enqueueOfflineRequest,
  isLikelyNetworkError,
} from "@/lib/offlineQueue";
import { saveLocalDraft, removeLocalDraft } from "@/lib/localDrafts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InfiniteYearPicker } from "@/components/ui/infinite-year-picker";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  AlertCircle,
  AlertTriangle,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronsUpDown,
  ClipboardList,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  Save,
  Search,
  Upload,
  User,
  X,
} from "lucide-react";
import * as XLSX from "xlsx";
import type {
  Assessment,
  AssessmentComment,
  Class as ClassType,
  Grade,
  Student,
  Subject,
} from "@shared/schema";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { LanguageCheckButton, type LanguageFieldBinding } from "@/features/language-tools";

interface AssessmentPaper {
  id: number;
  paperName: string;
  paperMarks: number;
  paperWeightPct: string;
}

interface AssessmentMarkPaper {
  assessmentPaperId: number;
  markObtained: string | null;
}

interface AssessmentMark {
  id: number;
  studentId: number;
  percentage: string | null;
  gradeId: number | null;
  attStatus: string;
  commentSource: string;
  customCommentText: string | null;
  autoCommentSnapshot: string | null;
  paperMarks: AssessmentMarkPaper[];
}

type MarksEntryGrade = Grade & {
  resolutionProfilePriority?: number;
  resolutionProfileSource?: "exact" | "unscoped";
};

interface MarksEntryData {
  assessment: Assessment;
  papers: AssessmentPaper[];
  students: Student[];
  marksByStudent: Record<number, AssessmentMark>;
  grades: MarksEntryGrade[];
  comments: AssessmentComment[];
  gradeProfileKey?: string | null;
  publication?: { isPublished: boolean; status: string };
}

interface StudentMarkState {
  paperMarks: Record<number, string>;
  attStatus: string;
  commentSource: string;
  customCommentText: string;
  autoCommentSnapshot: string;
  isDirty: boolean;
  isSaving: boolean;
  validationError: string | null;
  editVersion: number;
}

type MarksStateByAssessment = Record<number, Record<number, StudentMarkState>>;

interface ValidationWarning {
  assessmentId: number;
  studentId: number;
  paperId: number;
  message: string;
}

interface ClassSubjectRow {
  id: number;
  classId: number;
  subjectId: number;
}

interface StaffAssignment {
  id: number;
  subjectId: number;
  classId: number | null;
}

interface CombinedWorkbookMetadataPaper {
  id: number;
  name: string;
  maxMark: number;
  column: number;
}

interface CombinedWorkbookMetadataAssessment {
  id: number;
  name: string;
  statusColumn: number;
  papers: CombinedWorkbookMetadataPaper[];
}

interface CombinedWorkbookMetadata {
  format: "FCGS_COMBINED_MARKS";
  version: number;
  schoolId: number | null;
  classId: number;
  subjectId: number;
  academicYear: string;
  termFilter: string;
  assessments: CombinedWorkbookMetadataAssessment[];
}

interface ImportedAssessmentEntry {
  studentId: number;
  paperMarks: Record<number, string>;
  attStatus: string;
}

interface PendingImportAssessment {
  assessmentId: number;
  name: string;
  paperCount: number;
  recordCount: number;
  skippedCount: number;
  isCurrentlySelected: boolean;
  isPublished: boolean;
  entries: ImportedAssessmentEntry[];
  data: MarksEntryData;
}

interface PendingCombinedImport {
  fileName: string;
  assessments: PendingImportAssessment[];
}

const TERM_OPTIONS = [
  { value: "none", label: "All Terms" },
  { value: "term1", label: "Term 1" },
  { value: "vac1", label: "Vacation 1" },
  { value: "term2", label: "Term 2" },
  { value: "vac2", label: "Vacation 2" },
  { value: "term3", label: "Term 3" },
];

const STATUS_OPTIONS = [
  { value: "none", label: "---" },
  { value: "present", label: "Present" },
  { value: "absent", label: "Absent" },
  { value: "sick", label: "Sick" },
  { value: "excused", label: "Excused" },
];

function entryKey(assessmentId: number, studentId: number) {
  return `${assessmentId}:${studentId}`;
}

function assessmentColumnCount(data: MarksEntryData, condensed = false) {
  return data.papers.length + (condensed ? 1 : 5);
}

export default function MarksEntryPage() {
  const { toast } = useToast();
  const { currentSchoolId, user } = useAuth();
  const schoolScopeId = currentSchoolId || user?.schoolId || null;
  const isTeacherScoped =
    user?.role === "teacher" || user?.role === "assistant_teacher";
  const currentYear = new Date().getFullYear();

  const [selectedAcademicYear, setSelectedAcademicYear] = useState(
    String(currentYear),
  );
  const [selectedClassId, setSelectedClassId] = useState("");
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [selectedTermFilter, setSelectedTermFilter] = useState("none");
  const [selectedAssessmentIds, setSelectedAssessmentIds] = useState<string[]>(
    [],
  );
  const [desktopAssessmentPickerOpen, setDesktopAssessmentPickerOpen] =
    useState(false);
  const [mobileAssessmentPickerOpen, setMobileAssessmentPickerOpen] =
    useState(false);
  const [studentSearch, setStudentSearch] = useState("");
  const [studentMarks, setStudentMarks] = useState<MarksStateByAssessment>({});
  const [validationWarnings, setValidationWarnings] = useState<
    ValidationWarning[]
  >([]);
  const [pendingImport, setPendingImport] =
    useState<PendingCombinedImport | null>(null);
  const [selectedImportAssessmentIds, setSelectedImportAssessmentIds] =
    useState<number[]>([]);
  const [isParsingImport, setIsParsingImport] = useState(false);
  const [isApplyingImport, setIsApplyingImport] = useState(false);

  const studentMarksRef = useRef<MarksStateByAssessment>({});
  const marksDataByAssessmentRef = useRef<Record<number, MarksEntryData>>({});
  const autoSaveTimers = useRef<Record<string, NodeJS.Timeout>>({});
  const savingEntries = useRef<Set<string>>(new Set());
  const initializedAssessmentsRef = useRef<Set<number>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const saveMutationRef = useRef<any>(null);

  const { data: classesResponse } = useQuery<any>({
    queryKey: ["/api/classes", schoolScopeId, "marks-entry"],
    enabled: !!schoolScopeId,
    queryFn: async () => {
      const res = await schoolFetch("/api/classes");
      if (!res.ok) throw new Error("Failed to fetch classes");
      return res.json();
    },
  });
  const classes: ClassType[] = Array.isArray(classesResponse)
    ? classesResponse
    : (classesResponse?.items ?? []);

  const { data: subjectsData } = useQuery<any>({
    queryKey: ["/api/subjects", schoolScopeId, "marks-entry"],
    enabled: !!schoolScopeId,
    queryFn: async () => {
      const res = await schoolFetch("/api/subjects");
      if (!res.ok) throw new Error("Failed to fetch subjects");
      return res.json();
    },
  });
  const subjects: Subject[] = Array.isArray(subjectsData)
    ? subjectsData
    : (subjectsData?.items ?? []);

  const { data: classSubjectRows } = useQuery<ClassSubjectRow[]>({
    queryKey: ["/api/class-subjects/all", schoolScopeId, "marks-entry"],
    enabled: !!schoolScopeId,
    queryFn: async () => {
      const res = await schoolFetch("/api/class-subjects/all");
      if (!res.ok) throw new Error("Failed to fetch class subjects");
      return res.json();
    },
  });

  const { data: currentStaffAssignmentsResponse } = useQuery<any>({
    queryKey: ["/api/me/subject-assignments", schoolScopeId, "marks-entry"],
    enabled: !!schoolScopeId && isTeacherScoped,
    queryFn: async () => {
      const res = await schoolFetch("/api/me/subject-assignments");
      if (!res.ok) throw new Error("Failed to fetch teacher assignments");
      return res.json();
    },
  });
  const currentStaffAssignments: StaffAssignment[] = Array.isArray(
    currentStaffAssignmentsResponse,
  )
    ? currentStaffAssignmentsResponse
    : (currentStaffAssignmentsResponse?.items ?? []);

  const teacherAssignmentsWithClass = useMemo(
    () =>
      currentStaffAssignments.filter(
        (row) => row.classId !== null && row.classId !== undefined,
      ),
    [currentStaffAssignments],
  );

  const filteredClasses = useMemo(() => {
    if (!isTeacherScoped) return classes;
    return classes.filter((cls) => {
      const classMatchesTeacher = teacherAssignmentsWithClass.some(
        (row) => Number(row.classId) === cls.id,
      );
      if (!classMatchesTeacher) return false;
      if (!selectedSubjectId) return true;
      return teacherAssignmentsWithClass.some(
        (row) =>
          Number(row.classId) === cls.id &&
          Number(row.subjectId) === Number(selectedSubjectId),
      );
    });
  }, [
    classes,
    isTeacherScoped,
    teacherAssignmentsWithClass,
    selectedSubjectId,
  ]);

  const classCompatibleSubjects = useMemo(() => {
    if (!selectedClassId) return subjects;
    const subjectIds = new Set(
      (classSubjectRows || [])
        .filter((row) => row.classId === Number(selectedClassId))
        .map((row) => row.subjectId),
    );
    return subjectIds.size > 0
      ? subjects.filter((subject) => subjectIds.has(subject.id))
      : subjects;
  }, [selectedClassId, subjects, classSubjectRows]);

  const filteredSubjects = useMemo(() => {
    if (!isTeacherScoped) return classCompatibleSubjects;
    return classCompatibleSubjects.filter((subject) => {
      if (!selectedClassId) {
        return teacherAssignmentsWithClass.some(
          (row) => Number(row.subjectId) === subject.id,
        );
      }
      return teacherAssignmentsWithClass.some(
        (row) =>
          Number(row.classId) === Number(selectedClassId) &&
          Number(row.subjectId) === subject.id,
      );
    });
  }, [
    classCompatibleSubjects,
    isTeacherScoped,
    teacherAssignmentsWithClass,
    selectedClassId,
  ]);

  const { data: assessments = [] } = useQuery<Assessment[]>({
    queryKey: [
      "/api/assessments",
      schoolScopeId,
      selectedAcademicYear,
      selectedClassId,
      selectedSubjectId,
      selectedTermFilter,
    ],
    queryFn: async () => {
      if (!selectedClassId || !selectedSubjectId) return [];
      const params = new URLSearchParams();
      params.set("academicYear", selectedAcademicYear);
      params.set("classId", selectedClassId);
      params.set("subjectId", selectedSubjectId);
      if (selectedTermFilter !== "none")
        params.set("termFilter", selectedTermFilter);
      const res = await schoolFetch(`/api/assessments?${params}`);
      if (!res.ok) throw new Error("Failed to fetch assessments");
      return res.json();
    },
    enabled: !!schoolScopeId && !!selectedClassId && !!selectedSubjectId,
  });

  const selectedAssessmentNumbers = useMemo(
    () =>
      selectedAssessmentIds
        .map(Number)
        .filter((id) => Number.isInteger(id) && id > 0),
    [selectedAssessmentIds],
  );
  const isMultiAssessmentMode = selectedAssessmentNumbers.length > 1;

  const fetchMarksEntryData = useCallback(
    async (assessmentId: number): Promise<MarksEntryData> => {
      const res = await schoolFetch(`/api/marks-entry/${assessmentId}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || "Failed to load marks entry data");
      }
      return res.json();
    },
    [],
  );

  const marksQueries = useQueries({
    queries: selectedAssessmentNumbers.map((assessmentId) => ({
      queryKey: ["/api/marks-entry", String(assessmentId)],
      enabled: !!assessmentId,
      queryFn: () => fetchMarksEntryData(assessmentId),
    })),
  });

  const marksDataByAssessment: Record<number, MarksEntryData> = {};
  selectedAssessmentNumbers.forEach((assessmentId, index) => {
    const data = marksQueries[index]?.data;
    if (data) marksDataByAssessment[assessmentId] = data;
  });

  const isAssessmentPublished = useCallback(
    (assessmentId: number) => marksDataByAssessmentRef.current[assessmentId]?.publication?.isPublished === true,
    [],
  );

  const selectedAssessments = useMemo(
    () =>
      selectedAssessmentNumbers
        .map((id) => assessments.find((assessment) => assessment.id === id))
        .filter((assessment): assessment is Assessment => Boolean(assessment)),
    [assessments, selectedAssessmentNumbers],
  );

  const selectedClass = classes.find(
    (item) => item.id === Number(selectedClassId),
  );
  const selectedSubject = subjects.find(
    (item) => item.id === Number(selectedSubjectId),
  );

  const dirtyCount = useMemo(() => {
    let count = 0;
    Object.values(studentMarks).forEach((byStudent) => {
      Object.values(byStudent).forEach((entry) => {
        if (entry.isDirty) count += 1;
      });
    });
    return count;
  }, [studentMarks]);

  const savingCount = useMemo(() => {
    let count = 0;
    Object.values(studentMarks).forEach((byStudent) => {
      Object.values(byStudent).forEach((entry) => {
        if (entry.isSaving) count += 1;
      });
    });
    return count;
  }, [studentMarks]);

  const hasPendingChanges = dirtyCount > 0 || savingCount > 0;

  const resetAssessmentSelection = useCallback(() => {
    setSelectedAssessmentIds([]);
    setStudentSearch("");
    setValidationWarnings([]);
  }, []);

  const changeFilterSafely = useCallback(
    (change: () => void) => {
      if (hasPendingChanges) {
        toast({
          title: "Marks are still saving",
          description:
            "Wait for the current changes to save, or use Save All Marks before changing the filters.",
          variant: "destructive",
        });
        return;
      }
      resetAssessmentSelection();
      change();
    },
    [hasPendingChanges, resetAssessmentSelection, toast],
  );

  useEffect(() => {
    if (
      selectedClassId &&
      !filteredClasses.some((cls) => String(cls.id) === selectedClassId)
    ) {
      setSelectedClassId("");
      resetAssessmentSelection();
    }
  }, [selectedClassId, filteredClasses, resetAssessmentSelection]);

  useEffect(() => {
    if (
      selectedSubjectId &&
      !filteredSubjects.some(
        (subject) => String(subject.id) === selectedSubjectId,
      )
    ) {
      setSelectedSubjectId("");
      resetAssessmentSelection();
    }
  }, [selectedSubjectId, filteredSubjects, resetAssessmentSelection]);

  useEffect(() => {
    const available = new Set(
      assessments.map((assessment) => String(assessment.id)),
    );
    setSelectedAssessmentIds((current) =>
      current.filter((id) => available.has(id)),
    );
  }, [assessments]);

  const marksDataVersion = marksQueries
    .map((query) => query.dataUpdatedAt)
    .join("|");
  const selectedAssessmentKey = selectedAssessmentNumbers.join(",");

  useEffect(() => {
    setStudentMarks((current) => {
      const next: MarksStateByAssessment = {};

      selectedAssessmentNumbers.forEach((assessmentId, index) => {
        const data = marksQueries[index]?.data;
        if (!data) {
          if (current[assessmentId]) next[assessmentId] = current[assessmentId];
          return;
        }

        const initialByStudent: Record<number, StudentMarkState> = {};
        for (const student of data.students) {
          const existingMark = data.marksByStudent[student.id];
          const paperMarks: Record<number, string> = {};
          for (const paper of data.papers) {
            const existingPaperMark = existingMark?.paperMarks?.find(
              (item) => item.assessmentPaperId === paper.id,
            );
            if (
              existingPaperMark?.markObtained !== undefined &&
              existingPaperMark?.markObtained !== null &&
              existingPaperMark.markObtained !== ""
            ) {
              const numericMark = Number(existingPaperMark.markObtained);
              paperMarks[paper.id] = Number.isFinite(numericMark)
                ? String(Math.round(numericMark))
                : String(existingPaperMark.markObtained);
            } else {
              paperMarks[paper.id] = "";
            }
          }

          initialByStudent[student.id] = {
            paperMarks,
            attStatus: existingMark?.attStatus || "none",
            commentSource: existingMark?.commentSource || "pool",
            customCommentText: existingMark?.customCommentText || "",
            autoCommentSnapshot: existingMark?.autoCommentSnapshot || "",
            isDirty: false,
            isSaving: false,
            validationError: null,
            editVersion: 0,
          };
        }

        const wasInitialized =
          initializedAssessmentsRef.current.has(assessmentId);
        if (!wasInitialized) {
          next[assessmentId] = initialByStudent;
          initializedAssessmentsRef.current.add(assessmentId);
          return;
        }

        const currentByStudent = current[assessmentId] || {};
        const merged: Record<number, StudentMarkState> = {
          ...initialByStudent,
        };
        Object.entries(currentByStudent).forEach(
          ([studentIdKey, localEntry]) => {
            const studentId = Number(studentIdKey);
            if (!merged[studentId]) return;
            if (
              !localEntry.isDirty &&
              !localEntry.isSaving &&
              !localEntry.validationError
            )
              return;
            merged[studentId] = {
              ...merged[studentId],
              ...localEntry,
              paperMarks: {
                ...merged[studentId].paperMarks,
                ...localEntry.paperMarks,
              },
            };
          },
        );
        next[assessmentId] = merged;
      });

      return next;
    });
  }, [marksDataVersion, selectedAssessmentKey]);

  const displayedStudents = useMemo(() => {
    const studentMap = new Map<number, Student>();
    selectedAssessmentNumbers.forEach((assessmentId) => {
      marksDataByAssessment[assessmentId]?.students.forEach((student) => {
        if (!studentMap.has(student.id)) studentMap.set(student.id, student);
      });
    });
    const allStudents = Array.from(studentMap.values());
    const term = studentSearch.trim().toLowerCase();
    if (!term) return allStudents;
    return allStudents.filter((student) => {
      const name = `${student.firstName || ""} ${student.lastName || ""}`
        .trim()
        .toLowerCase();
      return (
        name.includes(term) ||
        String(student.admissionNo || "")
          .toLowerCase()
          .includes(term)
      );
    });
  }, [marksDataByAssessment, selectedAssessmentKey, studentSearch]);

  useEffect(() => {
    studentMarksRef.current = studentMarks;
  }, [studentMarks]);

  useEffect(() => {
    marksDataByAssessmentRef.current = marksDataByAssessment;
  }, [marksDataVersion, selectedAssessmentKey]);

  useEffect(
    () => () => {
      Object.values(autoSaveTimers.current).forEach(clearTimeout);
      autoSaveTimers.current = {};
    },
    [],
  );

  const getPoolComment = useCallback(
    (assessmentId: number, gradeId: number | null) => {
      if (!gradeId) return "";
      const data = marksDataByAssessmentRef.current[assessmentId];
      if (!data) return "";
      const exact = data.comments.find(
        (comment) => comment.gradeId === gradeId,
      );
      if (exact?.commentText) return exact.commentText;

      const gradeName = data.grades
        .find((grade) => grade.id === gradeId)
        ?.gradeName?.trim()
        .toUpperCase();
      if (!gradeName) return "";
      const fallback = data.comments.find((comment) => {
        const commentGradeName = data.grades
          .find((grade) => grade.id === comment.gradeId)
          ?.gradeName?.trim()
          .toUpperCase();
        return commentGradeName === gradeName;
      });
      return fallback?.commentText || "";
    },
    [],
  );

  const calculatePercentageAndGrade = useCallback(
    (assessmentId: number, paperMarks: Record<number, string>) => {
      const data = marksDataByAssessmentRef.current[assessmentId];
      if (!data)
        return {
          percentage: null as number | null,
          gradeName: "",
          gradeId: null as number | null,
        };

      let totalWeightedScore = 0;
      let totalWeight = 0;
      let hasAnyMark = false;
      for (const paper of data.papers) {
        const markValue = paperMarks[paper.id];
        if (markValue === "" || markValue === undefined) continue;
        hasAnyMark = true;
        const numericMark = Number(markValue);
        if (!Number.isFinite(numericMark)) continue;
        const markPercentage = (numericMark / paper.paperMarks) * 100;
        const weight = Number(paper.paperWeightPct);
        totalWeightedScore += (markPercentage * weight) / 100;
        totalWeight += weight;
      }

      if (!hasAnyMark)
        return { percentage: null, gradeName: "", gradeId: null };
      const allRequiredPapersMarked = data.papers.length > 0 && data.papers.every((paper) => {
        const value = paperMarks[paper.id];
        return value !== "" && value !== undefined;
      });
      const percentage =
        allRequiredPapersMarked && totalWeight > 0 ? Math.round(totalWeightedScore) : null;
      if (percentage === null)
        return { percentage, gradeName: "", gradeId: null };

      const orderedGrades = [...data.grades].sort((a, b) => {
        const priorityDiff = Number(a.resolutionProfilePriority ?? 0) - Number(b.resolutionProfilePriority ?? 0);
        if (priorityDiff !== 0) return priorityDiff;
        return Number(b.upperLimit) - Number(a.upperLimit);
      });
      const profilePriorities = Array.from(new Set(
        orderedGrades.map((grade) => Number(grade.resolutionProfilePriority ?? 0)),
      )).sort((a, b) => a - b);

      // Mirror the server's exact-profile grading precedence. No legacy or
      // cross-board profile is considered when the configured range is missing.
      for (const priority of profilePriorities) {
        const profileGrades = orderedGrades.filter(
          (grade) => Number(grade.resolutionProfilePriority ?? 0) === priority,
        );
        for (const grade of profileGrades) {
          const lower = Number(grade.lowerLimit);
          const upper = Number(grade.upperLimit);
          if (Number.isNaN(lower) || Number.isNaN(upper)) continue;
          if (percentage >= lower && percentage <= upper) {
            return { percentage, gradeName: grade.gradeName, gradeId: grade.id };
          }
        }
      }
      return { percentage, gradeName: "", gradeId: null };
    },
    [],
  );

  const recalculateEntry = useCallback(
    (
      assessmentId: number,
      studentId: number,
      newPaperMarks: Record<number, string>,
      newAttStatus: string,
    ): Partial<StudentMarkState> => {
      const hasMark = Object.values(newPaperMarks).some(
        (value) => value !== "" && value !== undefined,
      );
      const currentState = studentMarksRef.current[assessmentId]?.[studentId];

      if (!hasMark) {
        const normalizedStatus = ["present", "absent", "sick", "excused"].includes(newAttStatus)
          ? newAttStatus
          : "none";
        const statusComment = STATUS_OPTIONS.find((option) => option.value === normalizedStatus)?.label || "";
        return {
          attStatus: normalizedStatus,
          commentSource: "pool",
          customCommentText: "",
          autoCommentSnapshot: ["absent", "sick", "excused"].includes(normalizedStatus) ? statusComment : "",
        };
      }

      const status = "present";
      const { gradeId } = calculatePercentageAndGrade(
        assessmentId,
        newPaperMarks,
      );
      const poolComment = getPoolComment(assessmentId, gradeId);
      if (currentState?.commentSource === "custom") {
        return { attStatus: status, autoCommentSnapshot: poolComment };
      }
      return {
        attStatus: status,
        commentSource: "pool",
        customCommentText: poolComment,
        autoCommentSnapshot: poolComment,
      };
    },
    [calculatePercentageAndGrade, getPoolComment],
  );

  const queueMarksPayload = useCallback((payload: any) => {
    const data = marksDataByAssessmentRef.current[payload.assessmentId];
    const student = data?.students.find(
      (item) => item.id === payload.studentId,
    );
    const draftKey = `marks:${payload.assessmentId}:${payload.studentId}`;
    saveLocalDraft(
      draftKey,
      "marks",
      `Marks Entry - ${student?.firstName || ""} ${student?.lastName || ""}`.trim(),
      payload,
    );
    enqueueOfflineRequest({
      id: draftKey,
      module: "marks",
      title: "Marks Entry",
      subtitle: `${data?.assessment.name || "Assessment"} • ${student ? `${student.firstName || ""} ${student.lastName || ""}`.trim() : `Student ${payload.studentId}`}`,
      method: "POST",
      url: "/api/marks-entry",
      body: payload,
      invalidateKeys: [
        "/api/marks-entry",
        "/api/report-cards",
        "/api/report-hub/class-progress",
        "/api/report-hub/stream-stats",
      ],
    });
    return draftKey;
  }, []);

  const doSave = useCallback((assessmentId: number, studentId: number) => {
    const currentEntry = studentMarksRef.current[assessmentId]?.[studentId];
    const data = marksDataByAssessmentRef.current[assessmentId];
    const key = entryKey(assessmentId, studentId);
    if (data?.publication?.isPublished) return;
    if (
      !currentEntry?.isDirty ||
      !data ||
      savingEntries.current.has(key) ||
      !saveMutationRef.current
    )
      return;

    const paperMarks = data.papers.map((paper) => ({
      assessmentPaperId: paper.id,
      markObtained: currentEntry.paperMarks[paper.id]
        ? Number(currentEntry.paperMarks[paper.id])
        : null,
    }));
    const hasSavedMark = paperMarks.some(
      (paper) => paper.markObtained !== null,
    );
    const attStatus =
      !hasSavedMark && currentEntry.attStatus === "present"
        ? "none"
        : currentEntry.attStatus;

    savingEntries.current.add(key);
    setStudentMarks((current) => ({
      ...current,
      [assessmentId]: {
        ...current[assessmentId],
        [studentId]: { ...current[assessmentId]?.[studentId], isSaving: true },
      },
    }));

    saveMutationRef.current.mutate({
      assessmentId,
      studentId,
      paperMarks,
      attStatus,
      commentSource: currentEntry.commentSource,
      customCommentText:
        currentEntry.commentSource === "custom"
          ? currentEntry.customCommentText
          : null,
      autoCommentSnapshot: currentEntry.autoCommentSnapshot,
      editVersion: currentEntry.editVersion,
    });
  }, []);

  const saveMutation = useMutation({
    mutationFn: async (payload: any) => {
      const draftKey = `marks:${payload.assessmentId}:${payload.studentId}`;
      const data = marksDataByAssessmentRef.current[payload.assessmentId];
      const student = data?.students.find(
        (item) => item.id === payload.studentId,
      );
      saveLocalDraft(
        draftKey,
        "marks",
        `Marks Entry - ${student?.firstName || ""} ${student?.lastName || ""}`.trim(),
        payload,
      );

      if (typeof navigator !== "undefined" && !navigator.onLine) {
        queueMarksPayload(payload);
        return { offlineQueued: true, ...payload };
      }

      try {
        const response = await apiRequest("POST", "/api/marks-entry", payload);
        removeLocalDraft(draftKey);
        return response.json();
      } catch (error) {
        if (!isLikelyNetworkError(error)) throw error;
        queueMarksPayload(payload);
        return { offlineQueued: true, ...payload };
      }
    },
    onSuccess: (data: any, variables: any) => {
      const assessmentId = Number(variables.assessmentId);
      const studentId = Number(variables.studentId);
      savingEntries.current.delete(entryKey(assessmentId, studentId));

      setStudentMarks((current) => {
        const entry = current[assessmentId]?.[studentId];
        if (!entry) return current;
        const unchangedSinceSave = entry.editVersion === variables.editVersion;
        return {
          ...current,
          [assessmentId]: {
            ...current[assessmentId],
            [studentId]: {
              ...entry,
              isDirty: unchangedSinceSave ? false : entry.isDirty,
              isSaving: false,
              attStatus: unchangedSinceSave
                ? data.attStatus || variables.attStatus || "none"
                : entry.attStatus,
              autoCommentSnapshot: unchangedSinceSave
                ? data.autoCommentSnapshot || entry.autoCommentSnapshot
                : entry.autoCommentSnapshot,
            },
          },
        };
      });

      if (!data?.offlineQueued) {
        queryClient.setQueryData(
          ["/api/marks-entry", String(assessmentId)],
          (old: MarksEntryData | undefined) => {
            if (!old) return old;
            return {
              ...old,
              marksByStudent: {
                ...old.marksByStudent,
                [studentId]: {
                  id: data.id,
                  studentId,
                  percentage: data.percentage,
                  gradeId: data.gradeId,
                  attStatus: data.attStatus || variables.attStatus,
                  commentSource: data.commentSource || variables.commentSource,
                  customCommentText: data.customCommentText,
                  autoCommentSnapshot: data.autoCommentSnapshot,
                  paperMarks: (data.paperMarks || []).map((paperMark: any) => ({
                    assessmentPaperId: paperMark.assessmentPaperId,
                    markObtained: paperMark.markObtained,
                  })),
                },
              },
            };
          },
        );

        const assessment = marksDataByAssessmentRef.current[assessmentId]?.assessment;
        void queryClient.invalidateQueries({ queryKey: ["/api/report-cards"] });
        if (assessment?.examId && assessment?.classId) {
          void queryClient.invalidateQueries({
            queryKey: [
              "/api/report-hub/class-progress",
              String(assessment.examId),
              Number(assessment.classId),
            ],
          });
          void queryClient.invalidateQueries({
            queryKey: ["/api/report-hub/stream-stats", String(assessment.examId)],
          });
        }
      }

      window.setTimeout(() => {
        const latest = studentMarksRef.current[assessmentId]?.[studentId];
        if (latest?.isDirty) doSave(assessmentId, studentId);
      }, 100);
    },
    onError: (error: Error, variables: any) => {
      const assessmentId = Number(variables.assessmentId);
      const studentId = Number(variables.studentId);
      savingEntries.current.delete(entryKey(assessmentId, studentId));
      setStudentMarks((current) => ({
        ...current,
        [assessmentId]: {
          ...current[assessmentId],
          [studentId]: {
            ...current[assessmentId]?.[studentId],
            isSaving: false,
            isDirty: true,
          },
        },
      }));
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
  saveMutationRef.current = saveMutation;

  const triggerAutoSave = useCallback(
    (assessmentId: number, studentId: number) => {
      const key = entryKey(assessmentId, studentId);
      if (autoSaveTimers.current[key])
        clearTimeout(autoSaveTimers.current[key]);
      autoSaveTimers.current[key] = setTimeout(
        () => doSave(assessmentId, studentId),
        1500,
      );
    },
    [doSave],
  );

  const updateEntry = useCallback(
    (
      assessmentId: number,
      studentId: number,
      updater: (current: StudentMarkState) => StudentMarkState,
    ) => {
      setStudentMarks((current) => {
        const existing = current[assessmentId]?.[studentId];
        if (!existing) return current;
        return {
          ...current,
          [assessmentId]: {
            ...current[assessmentId],
            [studentId]: updater(existing),
          },
        };
      });
    },
    [],
  );

  const handlePaperMarkChange = useCallback(
    (
      assessmentId: number,
      studentId: number,
      paperId: number,
      rawValue: string,
    ) => {
      const data = marksDataByAssessmentRef.current[assessmentId];
      if (!data || data.publication?.isPublished) return;
      const value = rawValue.replace(/[^0-9]/g, "");
      if (rawValue !== value) {
        setValidationWarnings((current) => [
          ...current.filter(
            (warning) =>
              !(
                warning.assessmentId === assessmentId &&
                warning.studentId === studentId &&
                warning.paperId === paperId
              ),
          ),
          {
            assessmentId,
            studentId,
            paperId,
            message: "Marks must be whole numbers only",
          },
        ]);
        return;
      }

      const paper = data.papers.find((item) => item.id === paperId);
      if (paper && value !== "" && Number(value) > paper.paperMarks) {
        setValidationWarnings((current) => [
          ...current.filter(
            (warning) =>
              !(
                warning.assessmentId === assessmentId &&
                warning.studentId === studentId &&
                warning.paperId === paperId
              ),
          ),
          {
            assessmentId,
            studentId,
            paperId,
            message: `Mark cannot exceed ${paper.paperMarks}`,
          },
        ]);
        return;
      }

      setValidationWarnings((current) =>
        current.filter(
          (warning) =>
            !(
              warning.assessmentId === assessmentId &&
              warning.studentId === studentId &&
              warning.paperId === paperId
            ),
        ),
      );

      const existing = studentMarksRef.current[assessmentId]?.[studentId];
      if (!existing) return;
      const newPaperMarks = { ...existing.paperMarks, [paperId]: value };
      const recalculated = recalculateEntry(
        assessmentId,
        studentId,
        newPaperMarks,
        existing.attStatus,
      );
      updateEntry(assessmentId, studentId, (current) => ({
        ...current,
        paperMarks: newPaperMarks,
        ...recalculated,
        isDirty: true,
        editVersion: current.editVersion + 1,
      }));
      triggerAutoSave(assessmentId, studentId);
    },
    [recalculateEntry, triggerAutoSave, updateEntry],
  );

  const handleAttStatusChange = useCallback(
    (assessmentId: number, studentId: number, value: string) => {
      const data = marksDataByAssessmentRef.current[assessmentId];
      const existing = studentMarksRef.current[assessmentId]?.[studentId];
      if (!data || data.publication?.isPublished || !existing) return;

      const shouldClearMarks =
        value === "absent" || value === "sick" || value === "excused";
      const paperMarks = shouldClearMarks
        ? Object.fromEntries(data.papers.map((paper) => [paper.id, ""]))
        : existing.paperMarks;
      const recalculated = recalculateEntry(
        assessmentId,
        studentId,
        paperMarks,
        value,
      );

      updateEntry(assessmentId, studentId, (current) => ({
        ...current,
        paperMarks,
        attStatus: value,
        ...recalculated,
        isDirty: true,
        editVersion: current.editVersion + 1,
      }));
      triggerAutoSave(assessmentId, studentId);
    },
    [recalculateEntry, triggerAutoSave, updateEntry],
  );

  const handleCustomCommentChange = useCallback(
    (assessmentId: number, studentId: number, value: string) => {
      if (isAssessmentPublished(assessmentId)) return;
      updateEntry(assessmentId, studentId, (current) => ({
        ...current,
        customCommentText: value,
        commentSource: value.trim() === "" ? "pool" : "custom",
        isDirty: true,
        editVersion: current.editVersion + 1,
      }));
      triggerAutoSave(assessmentId, studentId);
    },
    [isAssessmentPublished, triggerAutoSave, updateEntry],
  );

  const handleManualSave = useCallback(
    (assessmentId: number, studentId: number) => {
      const key = entryKey(assessmentId, studentId);
      if (autoSaveTimers.current[key])
        clearTimeout(autoSaveTimers.current[key]);
      doSave(assessmentId, studentId);
    },
    [doSave],
  );

  const handleSaveStudentRow = useCallback(
    (studentId: number) => {
      let queued = 0;
      selectedAssessmentNumbers.forEach((assessmentId) => {
        if (isAssessmentPublished(assessmentId)) return;
        const entry = studentMarksRef.current[assessmentId]?.[studentId];
        if (!entry?.isDirty || entry.isSaving) return;
        const key = entryKey(assessmentId, studentId);
        if (autoSaveTimers.current[key])
          clearTimeout(autoSaveTimers.current[key]);
        queued += 1;
        doSave(assessmentId, studentId);
      });

      if (queued === 0) {
        toast({
          title: "Student marks are saved",
          description: "There are no unsaved changes in this row.",
        });
      }
    },
    [doSave, isAssessmentPublished, selectedAssessmentNumbers, toast],
  );

  const getStudentRowSaveState = useCallback(
    (studentId: number) => {
      const entries = selectedAssessmentNumbers
        .filter((assessmentId) => !marksDataByAssessment[assessmentId]?.publication?.isPublished)
        .map((assessmentId) => studentMarks[assessmentId]?.[studentId])
        .filter((entry): entry is StudentMarkState => Boolean(entry));
      return {
        isDirty: entries.some((entry) => entry.isDirty),
        isSaving: entries.some((entry) => entry.isSaving),
      };
    },
    [marksDataByAssessment, selectedAssessmentNumbers, studentMarks],
  );

  const handleSaveAll = useCallback(() => {
    let queued = 0;
    selectedAssessmentNumbers.forEach((assessmentId) => {
      if (isAssessmentPublished(assessmentId)) return;
      Object.entries(studentMarksRef.current[assessmentId] || {}).forEach(
        ([studentIdKey, entry]) => {
          if (!entry.isDirty || entry.isSaving) return;
          const studentId = Number(studentIdKey);
          const key = entryKey(assessmentId, studentId);
          if (autoSaveTimers.current[key])
            clearTimeout(autoSaveTimers.current[key]);
          queued += 1;
          doSave(assessmentId, studentId);
        },
      );
    });
    if (queued === 0) {
      toast({
        title: "All marks are saved",
        description: "There are no unsaved changes.",
      });
    }
  }, [doSave, isAssessmentPublished, selectedAssessmentNumbers, toast]);

  const toggleAssessment = useCallback(
    (assessmentId: string) => {
      const isSelected = selectedAssessmentIds.includes(assessmentId);
      if (isSelected) {
        const numericId = Number(assessmentId);
        const hasDirtyAssessmentEntries = Object.values(
          studentMarksRef.current[numericId] || {},
        ).some((entry) => entry.isDirty || entry.isSaving);
        if (hasDirtyAssessmentEntries) {
          toast({
            title: "Assessment still has unsaved changes",
            description:
              "Save the assessment marks before removing it from this entry session.",
            variant: "destructive",
          });
          return;
        }
        setSelectedAssessmentIds((current) =>
          current.filter((id) => id !== assessmentId),
        );
        initializedAssessmentsRef.current.delete(numericId);
        return;
      }
      setSelectedAssessmentIds((current) => [...current, assessmentId]);
    },
    [selectedAssessmentIds, toast],
  );

  const clearAssessmentSelection = useCallback(() => {
    if (hasPendingChanges) {
      toast({
        title: "Marks are still saving",
        description:
          "Save all changes before clearing the selected assessments.",
        variant: "destructive",
      });
      return;
    }
    setSelectedAssessmentIds([]);
    setDesktopAssessmentPickerOpen(false);
    setMobileAssessmentPickerOpen(false);
  }, [hasPendingChanges, toast]);

  const getGradeColor = (gradeName: string) => {
    switch (gradeName.toUpperCase()) {
      case "A*":
      case "A":
        return "bg-green-500/10 text-green-700 border-green-300 dark:text-green-400";
      case "B":
        return "bg-blue-500/10 text-blue-700 border-blue-300 dark:text-blue-400";
      case "C":
        return "bg-yellow-500/10 text-yellow-700 border-yellow-300 dark:text-yellow-400";
      case "D":
      case "E":
        return "bg-orange-500/10 text-orange-700 border-orange-300 dark:text-orange-400";
      case "F":
      case "U":
        return "bg-red-500/10 text-red-700 border-red-300 dark:text-red-400";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const getStatusLabel = useCallback((status: string) => {
    return (
      STATUS_OPTIONS.find((option) => option.value === status)?.label || "---"
    );
  }, []);

  const normalizeImportedStatus = useCallback(
    (value: unknown): string | null => {
      const normalized = String(value ?? "")
        .trim()
        .toLowerCase();
      if (normalized === "") return "";
      if (["---", "none", "not entered", "n/a"].includes(normalized))
        return "none";
      const matched = STATUS_OPTIONS.find(
        (option) =>
          option.value === normalized ||
          option.label.toLowerCase() === normalized,
      );
      return matched?.value || null;
    },
    [],
  );

  const buildCombinedWorkbook = useCallback(
    (includeMarks: boolean): XLSX.WorkBook | null => {
      if (
        selectedAssessmentNumbers.length === 0 ||
        !selectedClass ||
        !selectedSubject
      )
        return null;

      const assessmentData = selectedAssessmentNumbers
        .map((assessmentId) => marksDataByAssessmentRef.current[assessmentId])
        .filter((data): data is MarksEntryData => Boolean(data));
      if (assessmentData.length !== selectedAssessmentNumbers.length)
        return null;

      const studentMap = new Map<number, Student>();
      assessmentData.forEach((data) => {
        data.students.forEach((student) => {
          if (!studentMap.has(student.id)) studentMap.set(student.id, student);
        });
      });
      const students = Array.from(studentMap.values()).sort((a, b) =>
        (a.firstName || "").localeCompare(b.firstName || "", undefined, { sensitivity: "base", numeric: true }) ||
        (a.lastName || "").localeCompare(b.lastName || "", undefined, { sensitivity: "base", numeric: true }) ||
        (a.admissionNo || "").localeCompare(b.admissionNo || "", undefined, { sensitivity: "base", numeric: true }) ||
        a.id - b.id,
      );

      const headerRow: any[] = [
        "Student ID",
        "Admission Number",
        "Student Name",
      ];
      const fieldRow: any[] = ["", "", ""];
      const metadataAssessments: CombinedWorkbookMetadataAssessment[] = [];
      const merges: XLSX.Range[] = [
        { s: { r: 0, c: 0 }, e: { r: 1, c: 0 } },
        { s: { r: 0, c: 1 }, e: { r: 1, c: 1 } },
        { s: { r: 0, c: 2 }, e: { r: 1, c: 2 } },
      ];
      const columnWidths: XLSX.ColInfo[] = [
        { wch: 12 },
        { wch: 20 },
        { wch: 30 },
      ];

      let columnIndex = 3;
      assessmentData.forEach((data) => {
        const startColumn = columnIndex;
        headerRow[columnIndex] = data.assessment.name;
        fieldRow[columnIndex] = "Status";
        const statusColumn = columnIndex;
        columnWidths[columnIndex] = { wch: 14 };
        columnIndex += 1;

        const metadataPapers: CombinedWorkbookMetadataPaper[] = [];
        data.papers.forEach((paper) => {
          headerRow[columnIndex] = data.assessment.name;
          fieldRow[columnIndex] = `${paper.paperName} /${paper.paperMarks}`;
          columnWidths[columnIndex] = {
            wch: Math.max(16, Math.min(28, paper.paperName.length + 8)),
          };
          metadataPapers.push({
            id: paper.id,
            name: paper.paperName,
            maxMark: paper.paperMarks,
            column: columnIndex,
          });
          columnIndex += 1;
        });

        merges.push({
          s: { r: 0, c: startColumn },
          e: { r: 0, c: columnIndex - 1 },
        });
        metadataAssessments.push({
          id: data.assessment.id,
          name: data.assessment.name,
          statusColumn,
          papers: metadataPapers,
        });
      });

      const rows: any[][] = [headerRow, fieldRow];
      students.forEach((student) => {
        const row: any[] = [
          student.id,
          student.admissionNo || "",
          `${student.lastName} ${student.firstName}`.trim(),
        ];
        metadataAssessments.forEach((metadataAssessment) => {
          const data = marksDataByAssessmentRef.current[metadataAssessment.id];
          const isInRoster = data?.students.some(
            (item) => item.id === student.id,
          );
          if (!isInRoster) {
            row[metadataAssessment.statusColumn] = "";
            metadataAssessment.papers.forEach((paper) => {
              row[paper.column] = "";
            });
            return;
          }

          const currentEntry =
            studentMarksRef.current[metadataAssessment.id]?.[student.id];
          row[metadataAssessment.statusColumn] = includeMarks
            ? getStatusLabel(currentEntry?.attStatus || "none")
            : "";
          metadataAssessment.papers.forEach((paper) => {
            const mark = currentEntry?.paperMarks?.[paper.id] ?? "";
            row[paper.column] = includeMarks && mark !== "" ? Number(mark) : "";
          });
        });
        rows.push(row);
      });

      const worksheet = XLSX.utils.aoa_to_sheet(rows);
      worksheet["!merges"] = merges;
      worksheet["!cols"] = columnWidths;
      worksheet["!autofilter"] = {
        ref: XLSX.utils.encode_range({
          s: { r: 1, c: 0 },
          e: { r: rows.length - 1, c: columnIndex - 1 },
        }),
      };

      const metadata: CombinedWorkbookMetadata = {
        format: "FCGS_COMBINED_MARKS",
        version: 1,
        schoolId: schoolScopeId ? Number(schoolScopeId) : null,
        classId: selectedClass.id,
        subjectId: selectedSubject.id,
        academicYear: selectedAcademicYear,
        termFilter: selectedTermFilter,
        assessments: metadataAssessments,
      };
      const metadataWorksheet = XLSX.utils.aoa_to_sheet([
        [JSON.stringify(metadata)],
      ]);

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Marks Entry");
      XLSX.utils.book_append_sheet(
        workbook,
        metadataWorksheet,
        "FCGS Metadata",
      );
      workbook.Workbook = workbook.Workbook || {};
      workbook.Workbook.Sheets = [
        { name: "Marks Entry", Hidden: 0 },
        { name: "FCGS Metadata", Hidden: 1 },
      ];
      return workbook;
    },
    [
      getStatusLabel,
      schoolScopeId,
      selectedAcademicYear,
      selectedAssessmentNumbers,
      selectedClass,
      selectedSubject,
      selectedTermFilter,
    ],
  );

  const downloadCombinedWorkbook = useCallback(
    (includeMarks: boolean) => {
      const workbook = buildCombinedWorkbook(includeMarks);
      if (!workbook) {
        toast({
          title: "Assessments are still loading",
          description:
            "Wait for all selected assessments to finish loading, then try again.",
          variant: "destructive",
        });
        return;
      }
      const className =
        selectedClass?.className?.replace(/\s+/g, "_") || "class";
      const subjectName =
        selectedSubject?.name?.replace(/\s+/g, "_") || "subject";
      const prefix = includeMarks
        ? "Combined_Marks"
        : "Combined_Marks_Template";
      XLSX.writeFile(
        workbook,
        `${prefix}_${className}_${subjectName}_${selectedAssessmentNumbers.length}_Assessments.xlsx`,
      );
    },
    [
      buildCombinedWorkbook,
      selectedAssessmentNumbers.length,
      selectedClass?.className,
      selectedSubject?.name,
      toast,
    ],
  );

  const openImportFilePicker = useCallback(() => {
    if (!selectedClassId || !selectedSubjectId || !selectedAcademicYear) {
      toast({
        title: "Select the marks context first",
        description:
          "Choose the academic year, class and subject before uploading a workbook.",
        variant: "destructive",
      });
      return;
    }
    fileInputRef.current?.click();
  }, [selectedAcademicYear, selectedClassId, selectedSubjectId, toast]);

  const parseLegacySingleAssessmentWorkbook = useCallback(
    async (
      workbook: XLSX.WorkBook,
      fileName: string,
    ): Promise<PendingCombinedImport> => {
      if (selectedAssessmentNumbers.length !== 1) {
        throw new Error(
          "This workbook does not contain combined marks metadata. Select its single assessment first, or download a fresh combined template.",
        );
      }
      const assessmentId = selectedAssessmentNumbers[0];
      const data = (await queryClient.fetchQuery({
        queryKey: ["/api/marks-entry", String(assessmentId)],
        queryFn: () => fetchMarksEntryData(assessmentId),
      })) as MarksEntryData;
      marksDataByAssessmentRef.current = {
        ...marksDataByAssessmentRef.current,
        [assessmentId]: data,
      };

      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows: (string | number | null)[][] = XLSX.utils.sheet_to_json(
        worksheet,
        { header: 1, defval: "" },
      );
      if (rows.length < 6)
        throw new Error(
          "The legacy workbook does not contain the expected header and student rows.",
        );

      const paperColumnMap: Record<number, number> = {};
      const paperRow = rows[3] || [];
      for (let column = 2; column < paperRow.length; column += 1) {
        const match = String(paperRow[column] || "").match(/-(\d+)$/);
        if (!match) continue;
        const paperId = Number(match[1]);
        if (data.papers.some((paper) => paper.id === paperId))
          paperColumnMap[column] = paperId;
      }
      if (Object.keys(paperColumnMap).length === 0) {
        data.papers.forEach((paper, index) => {
          paperColumnMap[2 + index] = paper.id;
        });
      }

      const entries: ImportedAssessmentEntry[] = [];
      let skippedCount = 0;
      for (let rowIndex = 5; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex] || [];
        const studentId = Number(row[0]);
        const studentName = String(row[1] || "")
          .trim()
          .toLowerCase();
        let student = Number.isInteger(studentId)
          ? data.students.find((item) => item.id === studentId)
          : undefined;
        if (!student && studentName) {
          student = data.students.find((item) => {
            const surnameFirst = `${item.lastName} ${item.firstName}`
              .trim()
              .toLowerCase();
            const firstNameFirst = `${item.firstName} ${item.lastName}`
              .trim()
              .toLowerCase();
            return (
              surnameFirst === studentName || firstNameFirst === studentName
            );
          });
        }
        if (!student) {
          if (row.some((cell) => String(cell ?? "").trim() !== ""))
            skippedCount += 1;
          continue;
        }

        const paperMarks: Record<number, string> = {};
        let touched = false;
        let valid = true;
        for (const [columnKey, paperId] of Object.entries(paperColumnMap)) {
          const raw = String(row[Number(columnKey)] ?? "").trim();
          if (raw !== "") touched = true;
          const paper = data.papers.find((item) => item.id === paperId);
          if (!paper) continue;
          if (raw !== "") {
            const mark = Number(raw);
            if (
              !Number.isInteger(mark) ||
              mark < 0 ||
              mark > paper.paperMarks
            ) {
              valid = false;
              break;
            }
          }
          paperMarks[paperId] = raw;
        }
        if (!touched) continue;
        if (!valid) {
          skippedCount += 1;
          continue;
        }
        entries.push({
          studentId: student.id,
          paperMarks,
          attStatus: Object.values(paperMarks).some((value) => value !== "")
            ? "present"
            : "none",
        });
      }

      return {
        fileName,
        assessments: [
          {
            assessmentId,
            name: data.assessment.name,
            paperCount: data.papers.length,
            recordCount: entries.length,
            skippedCount,
            isCurrentlySelected: true,
            isPublished: data.publication?.isPublished === true,
            entries,
            data,
          },
        ],
      };
    },
    [fetchMarksEntryData, selectedAssessmentNumbers],
  );

  const handleImportFile = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      setIsParsingImport(true);

      try {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array" });
        const metadataSheet = workbook.Sheets["FCGS Metadata"];

        if (!metadataSheet?.A1?.v) {
          const legacyPreview = await parseLegacySingleAssessmentWorkbook(
            workbook,
            file.name,
          );
          setPendingImport(legacyPreview);
          setSelectedImportAssessmentIds(
            legacyPreview.assessments
              .filter((item) => item.recordCount > 0 && !item.isPublished)
              .map((item) => item.assessmentId),
          );
          return;
        }

        let metadata: CombinedWorkbookMetadata;
        try {
          metadata = JSON.parse(String(metadataSheet.A1.v));
        } catch {
          throw new Error(
            "The workbook metadata is damaged. Download a fresh template and try again.",
          );
        }
        if (
          metadata.format !== "FCGS_COMBINED_MARKS" ||
          metadata.version !== 1
        ) {
          throw new Error(
            "This is not a supported FCGS combined marks workbook.",
          );
        }
        if (Number(metadata.classId) !== Number(selectedClassId)) {
          throw new Error("This workbook belongs to a different class.");
        }
        if (Number(metadata.subjectId) !== Number(selectedSubjectId)) {
          throw new Error("This workbook belongs to a different subject.");
        }
        if (String(metadata.academicYear) !== String(selectedAcademicYear)) {
          throw new Error(
            `This workbook belongs to academic year ${metadata.academicYear}.`,
          );
        }

        const availableAssessments = new Map(
          assessments.map((assessment) => [assessment.id, assessment]),
        );
        const unavailable = metadata.assessments.filter(
          (item) => !availableAssessments.has(item.id),
        );
        if (unavailable.length > 0) {
          throw new Error(
            `These workbook assessments are not available in the selected context: ${unavailable.map((item) => item.name).join(", ")}.`,
          );
        }

        const dataPairs = await Promise.all(
          metadata.assessments.map(async (item) => {
            const data = (await queryClient.fetchQuery({
              queryKey: ["/api/marks-entry", String(item.id)],
              queryFn: () => fetchMarksEntryData(item.id),
            })) as MarksEntryData;
            return [item.id, data] as const;
          }),
        );
        const dataMap = new Map<number, MarksEntryData>(dataPairs);
        marksDataByAssessmentRef.current = {
          ...marksDataByAssessmentRef.current,
          ...Object.fromEntries(dataPairs),
        };

        const staleAssessment = metadata.assessments.find((item) => {
          const data = dataMap.get(item.id);
          if (!data) return true;
          const workbookPaperIds = [
            ...item.papers.map((paper) => paper.id),
          ].sort((a, b) => a - b);
          const currentPaperIds = [
            ...data.papers.map((paper) => paper.id),
          ].sort((a, b) => a - b);
          return (
            workbookPaperIds.length !== currentPaperIds.length ||
            workbookPaperIds.some(
              (paperId, index) => paperId !== currentPaperIds[index],
            )
          );
        });
        if (staleAssessment) {
          throw new Error(
            `The paper structure for ${staleAssessment.name} has changed since this workbook was created. Download a fresh template before importing.`,
          );
        }

        const worksheet =
          workbook.Sheets["Marks Entry"] ||
          workbook.Sheets[workbook.SheetNames[0]];
        const rows: (string | number | null)[][] = XLSX.utils.sheet_to_json(
          worksheet,
          { header: 1, defval: "" },
        );
        if (rows.length < 3)
          throw new Error("The workbook does not contain any student rows.");

        const previewAssessments: PendingImportAssessment[] =
          metadata.assessments.map((metadataAssessment) => {
            const data = dataMap.get(metadataAssessment.id)!;
            const entries: ImportedAssessmentEntry[] = [];
            let skippedCount = 0;

            for (let rowIndex = 2; rowIndex < rows.length; rowIndex += 1) {
              const row = rows[rowIndex] || [];
              const rawStatus = String(
                row[metadataAssessment.statusColumn] ?? "",
              ).trim();
              const rawPaperValues = metadataAssessment.papers.map((paper) =>
                String(row[paper.column] ?? "").trim(),
              );
              const touched =
                rawStatus !== "" ||
                rawPaperValues.some((value) => value !== "");
              if (!touched) continue;

              const studentId = Number(row[0]);
              const admissionNo = String(row[1] || "")
                .trim()
                .toLowerCase();
              const studentName = String(row[2] || "")
                .trim()
                .toLowerCase();
              let student = Number.isInteger(studentId)
                ? data.students.find((item) => item.id === studentId)
                : undefined;
              if (!student && admissionNo) {
                student = data.students.find(
                  (item) =>
                    String(item.admissionNo || "")
                      .trim()
                      .toLowerCase() === admissionNo,
                );
              }
              if (!student && studentName) {
                student = data.students.find((item) => {
                  const surnameFirst = `${item.lastName} ${item.firstName}`
                    .trim()
                    .toLowerCase();
                  const firstNameFirst = `${item.firstName} ${item.lastName}`
                    .trim()
                    .toLowerCase();
                  return (
                    surnameFirst === studentName ||
                    firstNameFirst === studentName
                  );
                });
              }
              if (!student) {
                skippedCount += 1;
                continue;
              }

              const importedStatus = normalizeImportedStatus(rawStatus);
              if (importedStatus === null) {
                skippedCount += 1;
                continue;
              }

              const paperMarks: Record<number, string> = {};
              let valid = true;
              metadataAssessment.papers.forEach((metadataPaper, paperIndex) => {
                if (!valid) return;
                const paper = data.papers.find(
                  (item) => item.id === metadataPaper.id,
                );
                if (!paper) {
                  valid = false;
                  return;
                }
                const rawMark = rawPaperValues[paperIndex];
                if (rawMark !== "") {
                  const mark = Number(rawMark);
                  if (
                    !Number.isInteger(mark) ||
                    mark < 0 ||
                    mark > paper.paperMarks
                  ) {
                    valid = false;
                    return;
                  }
                }
                paperMarks[paper.id] = rawMark;
              });
              if (!valid) {
                skippedCount += 1;
                continue;
              }

              const hasMark = Object.values(paperMarks).some(
                (value) => value !== "",
              );
              entries.push({
                studentId: student.id,
                paperMarks,
                attStatus: hasMark
                  ? "present"
                  : importedStatus === "present" || importedStatus === ""
                    ? "none"
                    : importedStatus,
              });
            }

            return {
              assessmentId: metadataAssessment.id,
              name: data.assessment.name,
              paperCount: data.papers.length,
              recordCount: entries.length,
              skippedCount,
              isCurrentlySelected: selectedAssessmentIds.includes(
                String(metadataAssessment.id),
              ),
              isPublished: data.publication?.isPublished === true,
              entries,
              data,
            };
          });

        if (previewAssessments.every((item) => item.recordCount === 0)) {
          throw new Error(
            "No valid marks or statuses were found in this workbook.",
          );
        }

        const preview: PendingCombinedImport = {
          fileName: file.name,
          assessments: previewAssessments,
        };
        setPendingImport(preview);
        setSelectedImportAssessmentIds(
          previewAssessments
            .filter((item) => item.recordCount > 0 && !item.isPublished)
            .map((item) => item.assessmentId),
        );
      } catch (error: any) {
        toast({
          title: "Import Error",
          description: error.message || "Failed to read workbook",
          variant: "destructive",
        });
      } finally {
        setIsParsingImport(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [
      assessments,
      fetchMarksEntryData,
      normalizeImportedStatus,
      parseLegacySingleAssessmentWorkbook,
      selectedAcademicYear,
      selectedAssessmentIds,
      selectedClassId,
      selectedSubjectId,
      toast,
    ],
  );

  const toggleImportAssessment = useCallback((assessmentId: number) => {
    const item = pendingImport?.assessments.find((assessment) => assessment.assessmentId === assessmentId);
    if (!item || item.isPublished || item.recordCount === 0) return;
    setSelectedImportAssessmentIds((current) =>
      current.includes(assessmentId)
        ? current.filter((id) => id !== assessmentId)
        : [...current, assessmentId],
    );
  }, [pendingImport]);

  const applyPendingImport = useCallback(async () => {
    if (!pendingImport || selectedImportAssessmentIds.length === 0) return;
    setIsApplyingImport(true);
    const selectedItems = pendingImport.assessments.filter((item) =>
      selectedImportAssessmentIds.includes(item.assessmentId) && !item.isPublished,
    );
    const saveTargets: Array<{ assessmentId: number; studentId: number }> = [];

    try {
      selectedItems.forEach((item) => {
        queryClient.setQueryData(
          ["/api/marks-entry", String(item.assessmentId)],
          item.data,
        );
        marksDataByAssessmentRef.current = {
          ...marksDataByAssessmentRef.current,
          [item.assessmentId]: item.data,
        };
        initializedAssessmentsRef.current.add(item.assessmentId);
      });

      setStudentMarks((current) => {
        const next: MarksStateByAssessment = { ...current };
        selectedItems.forEach((item) => {
          const currentByStudent = { ...(next[item.assessmentId] || {}) };
          item.data.students.forEach((student) => {
            if (currentByStudent[student.id]) return;
            const existingMark = item.data.marksByStudent[student.id];
            const paperMarks: Record<number, string> = {};
            item.data.papers.forEach((paper) => {
              const existingPaperMark = existingMark?.paperMarks?.find(
                (mark) => mark.assessmentPaperId === paper.id,
              );
              paperMarks[paper.id] =
                existingPaperMark?.markObtained !== null &&
                existingPaperMark?.markObtained !== undefined
                  ? String(Math.round(Number(existingPaperMark.markObtained)))
                  : "";
            });
            currentByStudent[student.id] = {
              paperMarks,
              attStatus: existingMark?.attStatus || "none",
              commentSource: existingMark?.commentSource || "pool",
              customCommentText: existingMark?.customCommentText || "",
              autoCommentSnapshot: existingMark?.autoCommentSnapshot || "",
              isDirty: false,
              isSaving: false,
              validationError: null,
              editVersion: 0,
            };
          });

          item.entries.forEach((entry) => {
            const existing = currentByStudent[entry.studentId];
            if (!existing) return;
            const hasMark = Object.values(entry.paperMarks).some(
              (value) => value !== "",
            );
            let recalculated: Partial<StudentMarkState>;
            if (!hasMark) {
              recalculated = {
                attStatus: entry.attStatus,
                commentSource: "pool",
                customCommentText: "",
                autoCommentSnapshot: "",
              };
            } else {
              const { gradeId } = calculatePercentageAndGrade(
                item.assessmentId,
                entry.paperMarks,
              );
              const poolComment = getPoolComment(item.assessmentId, gradeId);
              recalculated =
                existing.commentSource === "custom"
                  ? { attStatus: "present", autoCommentSnapshot: poolComment }
                  : {
                      attStatus: "present",
                      commentSource: "pool",
                      customCommentText: poolComment,
                      autoCommentSnapshot: poolComment,
                    };
            }
            currentByStudent[entry.studentId] = {
              ...existing,
              paperMarks: entry.paperMarks,
              ...recalculated,
              isDirty: true,
              isSaving: false,
              validationError: null,
              editVersion: existing.editVersion + 1,
            };
            saveTargets.push({
              assessmentId: item.assessmentId,
              studentId: entry.studentId,
            });
          });
          next[item.assessmentId] = currentByStudent;
        });
        studentMarksRef.current = next;
        return next;
      });

      setSelectedAssessmentIds((current) => {
        const next = [...current];
        selectedItems.forEach((item) => {
          const value = String(item.assessmentId);
          if (!next.includes(value)) next.push(value);
        });
        return next;
      });

      setPendingImport(null);
      setSelectedImportAssessmentIds([]);
      toast({
        title: "Import confirmed",
        description: `${saveTargets.length} student-assessment entr${saveTargets.length === 1 ? "y" : "ies"} will be saved and the imported assessments are now displayed.`,
      });
      window.setTimeout(() => {
        saveTargets.forEach(({ assessmentId, studentId }) =>
          triggerAutoSave(assessmentId, studentId),
        );
      }, 50);
    } finally {
      setIsApplyingImport(false);
    }
  }, [
    calculatePercentageAndGrade,
    getPoolComment,
    pendingImport,
    selectedImportAssessmentIds,
    toast,
    triggerAutoSave,
  ]);

  const isLoadingMarks = marksQueries.some((query) => query.isLoading);
  const marksError = marksQueries.find((query) => query.error)?.error as
    Error | undefined;
  const importContextReady = Boolean(
    selectedAcademicYear && selectedClassId && selectedSubjectId,
  );
  const combinedActionsReady =
    selectedAssessmentNumbers.length > 0 &&
    selectedAssessmentNumbers.every((assessmentId) =>
      Boolean(marksDataByAssessment[assessmentId]),
    );

  const assessmentTriggerText =
    selectedAssessments.length === 0
      ? "Select assessments..."
      : selectedAssessments.length === 1
        ? selectedAssessments[0].name
        : `${selectedAssessments.length} assessments selected`;

  const buildStudentLanguageFields = (studentId: number, assessmentIds = selectedAssessmentNumbers): LanguageFieldBinding[] => {
    const student = displayedStudents.find((item) => item.id === studentId);
    if (!student) return [];
    return assessmentIds.flatMap((assessmentId) => {
      const data = marksDataByAssessment[assessmentId];
      const entry = studentMarks[assessmentId]?.[studentId];
      if (!data || !entry || data.publication?.isPublished || !data.students.some((item) => item.id === studentId)) return [];
      const result = entry.attStatus === "present"
        ? calculatePercentageAndGrade(assessmentId, entry.paperMarks)
        : { percentage: null, gradeName: "", gradeId: null };
      const poolComment = getPoolComment(assessmentId, result.gradeId);
      const text = entry.commentSource === "custom"
        ? (entry.customCommentText || "")
        : (entry.autoCommentSnapshot || poolComment || "");
      return [{
        id: `marks:${assessmentId}:${studentId}`,
        label: data.assessment?.name || `Assessment ${assessmentId}`,
        text,
        onChange: (value: string) => handleCustomCommentChange(assessmentId, studentId, value),
        student: { id: student.id, firstName: student.firstName, lastName: student.lastName, gender: student.gender },
      }];
    });
  };

  const allMarksLanguageFields = displayedStudents.flatMap((student) => buildStudentLanguageFields(student.id));

  const renderAssessmentFields = (
    assessmentId: number,
    studentId: number,
    compact: boolean,
    condensed = false,
  ) => {
    const data = marksDataByAssessment[assessmentId];
    const entry = studentMarks[assessmentId]?.[studentId];
    if (
      !data ||
      !entry ||
      !data.students.some((student) => student.id === studentId)
    ) {
      return (
        <div className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
          Student is not in this assessment roster.
        </div>
      );
    }

    const result =
      entry.attStatus === "present"
        ? calculatePercentageAndGrade(assessmentId, entry.paperMarks)
        : { percentage: null, gradeName: "", gradeId: null };
    const poolComment = getPoolComment(assessmentId, result.gradeId);
    const displayComment =
      entry.commentSource === "custom" ? entry.customCommentText : (entry.autoCommentSnapshot || poolComment);
    const published = data.publication?.isPublished === true;
    const blocksMarks =
      published ||
      entry.attStatus === "absent" ||
      entry.attStatus === "sick" ||
      entry.attStatus === "excused";

    if (condensed) {
      if (compact) {
        return (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Status</Label>
              <Select
                value={entry.attStatus || "none"}
                disabled={published}
                onValueChange={(value) =>
                  handleAttStatusChange(assessmentId, studentId, value)
                }
              >
                <SelectTrigger
                  className="h-9 w-full text-xs"
                  data-testid={`select-status-${assessmentId}-${studentId}`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((status) => (
                    <SelectItem key={status.value} value={status.value}>
                      {status.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {data.papers.map((paper) => (
                <div key={paper.id} className="space-y-1">
                  <Label className="text-xs">
                    {paper.paperName} /{paper.paperMarks}
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    max={paper.paperMarks}
                    step={1}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    className="h-9 text-center text-sm"
                    value={entry.paperMarks[paper.id] || ""}
                    onChange={(event) =>
                      handlePaperMarkChange(
                        assessmentId,
                        studentId,
                        paper.id,
                        event.target.value,
                      )
                    }
                    disabled={blocksMarks}
                    data-testid={`input-mark-${assessmentId}-${studentId}-${paper.id}`}
                  />
                </div>
              ))}
            </div>
          </div>
        );
      }

      return (
        <>
          <TableCell className="border-l px-1 py-0.5 align-middle sm:py-1 sm:px-2">
            <Select
              value={entry.attStatus || "none"}
              disabled={published}
              onValueChange={(value) =>
                handleAttStatusChange(assessmentId, studentId, value)
              }
            >
              <SelectTrigger
                className="h-7 w-[68px] px-1 text-[10px] sm:h-8 sm:w-[76px] sm:px-2 sm:text-xs md:w-[82px] [&>span]:truncate"
                data-testid={`select-status-${assessmentId}-${studentId}`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((status) => (
                  <SelectItem key={status.value} value={status.value}>
                    {status.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </TableCell>
          {data.papers.map((paper) => (
            <TableCell
              key={paper.id}
              className="px-0.5 py-0.5 text-center align-middle sm:px-2 sm:py-1"
            >
              <Input
                type="number"
                min={0}
                max={paper.paperMarks}
                step={1}
                inputMode="numeric"
                pattern="[0-9]*"
                className="mx-auto h-7 w-14 px-1 text-center text-xs sm:h-8 sm:w-16 sm:text-sm md:w-20"
                value={entry.paperMarks[paper.id] || ""}
                onChange={(event) =>
                  handlePaperMarkChange(
                    assessmentId,
                    studentId,
                    paper.id,
                    event.target.value,
                  )
                }
                disabled={blocksMarks}
                data-testid={`input-mark-${assessmentId}-${studentId}-${paper.id}`}
              />
            </TableCell>
          ))}
        </>
      );
    }

    if (compact) {
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Status</Label>
              <Select
                value={entry.attStatus || "none"}
                disabled={published}
                onValueChange={(value) =>
                  handleAttStatusChange(assessmentId, studentId, value)
                }
              >
                <SelectTrigger
                  className="h-9 w-full text-xs"
                  data-testid={`select-status-${assessmentId}-${studentId}`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((status) => (
                    <SelectItem key={status.value} value={status.value}>
                      {status.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Result</Label>
              <div className="flex h-9 items-center gap-2 rounded-md border px-2 text-xs">
                <span>
                  {result.percentage !== null ? `${result.percentage}%` : "-"}
                </span>
                {result.gradeName ? (
                  <Badge
                    className={cn(
                      "border px-1.5 py-0 text-[10px]",
                      getGradeColor(result.gradeName),
                    )}
                  >
                    {result.gradeName}
                  </Badge>
                ) : null}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {data.papers.map((paper) => (
              <div key={paper.id} className="space-y-1">
                <Label className="text-xs">
                  {paper.paperName} /{paper.paperMarks}
                </Label>
                <Input
                  type="number"
                  min={0}
                  max={paper.paperMarks}
                  step={1}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  className="h-9 text-center text-sm"
                  value={entry.paperMarks[paper.id] || ""}
                  onChange={(event) =>
                    handlePaperMarkChange(
                      assessmentId,
                      studentId,
                      paper.id,
                      event.target.value,
                    )
                  }
                  disabled={blocksMarks}
                  data-testid={`input-mark-${assessmentId}-${studentId}-${paper.id}`}
                />
              </div>
            ))}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Comment</Label>
            <Textarea
              rows={2}
              disabled={published}
              className="min-h-16 resize-y text-xs"
              placeholder={poolComment || "No comment available"}
              value={displayComment || ""}
              onChange={(event) =>
                handleCustomCommentChange(
                  assessmentId,
                  studentId,
                  event.target.value,
                )
              }
              data-testid={`input-comment-${assessmentId}-${studentId}`}
            />
          </div>
          <div className="flex items-center gap-2">
            <LanguageCheckButton
              fields={buildStudentLanguageFields(studentId, [assessmentId])}
              className="flex-1"
              disabled={published}
            />
            <Button
            size="sm"
            className="h-8 flex-1 text-xs"
            onClick={() => handleManualSave(assessmentId, studentId)}
            disabled={published || entry.isSaving || !entry.isDirty}
            data-testid={`button-save-${assessmentId}-${studentId}`}
          >
            {entry.isSaving ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : entry.isDirty ? (
              <Save className="mr-1 h-4 w-4" />
            ) : (
              <CheckCircle2 className="mr-1 h-4 w-4" />
            )}
            {entry.isSaving ? "Saving" : entry.isDirty ? "Save" : "Saved"}
            </Button>
          </div>
        </div>
      );
    }

    return (
      <>
        <TableCell className="border-l px-1 py-0.5 align-middle sm:py-1 sm:px-2">
          <Select
            value={entry.attStatus || "none"}
            disabled={published}
            onValueChange={(value) =>
              handleAttStatusChange(assessmentId, studentId, value)
            }
          >
            <SelectTrigger
              className="h-7 w-[68px] px-1 text-[10px] sm:h-8 sm:w-[76px] sm:px-2 sm:text-xs md:w-[82px] [&>span]:truncate"
              data-testid={`select-status-${assessmentId}-${studentId}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((status) => (
                <SelectItem key={status.value} value={status.value}>
                  {status.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </TableCell>
        {data.papers.map((paper) => (
          <TableCell
            key={paper.id}
            className="px-0.5 py-0.5 text-center align-middle sm:px-2 sm:py-1"
          >
            <Input
              type="number"
              min={0}
              max={paper.paperMarks}
              step={1}
              inputMode="numeric"
              pattern="[0-9]*"
              className="mx-auto h-7 w-14 px-1 text-center text-xs sm:h-8 sm:w-16 sm:text-sm md:w-20"
              value={entry.paperMarks[paper.id] || ""}
              onChange={(event) =>
                handlePaperMarkChange(
                  assessmentId,
                  studentId,
                  paper.id,
                  event.target.value,
                )
              }
              disabled={blocksMarks}
              data-testid={`input-mark-${assessmentId}-${studentId}-${paper.id}`}
            />
          </TableCell>
        ))}
        <TableCell className="px-1 py-0.5 text-center text-[10px] font-semibold align-middle sm:px-2 sm:py-1 sm:text-xs md:text-sm">
          {result.percentage !== null ? `${result.percentage}%` : "-"}
        </TableCell>
        <TableCell className="px-1 py-0.5 text-center align-middle sm:px-2 sm:py-1">
          {result.gradeName ? (
            <Badge
              className={cn(
                "border px-1 py-0 text-[9px] sm:px-1.5 sm:text-xs",
                getGradeColor(result.gradeName),
              )}
            >
              {result.gradeName}
            </Badge>
          ) : (
            <span className="text-muted-foreground">-</span>
          )}
        </TableCell>
        <TableCell className="px-1 py-0.5 align-middle sm:px-2 sm:py-1">
          <Textarea
            rows={1}
            disabled={published}
            className="h-8 min-h-8 max-h-8 w-[190px] resize-none overflow-hidden px-1.5 py-1 text-[10px] sm:h-9 sm:min-h-9 sm:max-h-9 sm:w-[220px] sm:px-2 sm:text-xs md:w-[250px]"
            placeholder={poolComment || "No comment available"}
            value={displayComment || ""}
            onChange={(event) =>
              handleCustomCommentChange(
                assessmentId,
                studentId,
                event.target.value,
              )
            }
            data-testid={`input-comment-${assessmentId}-${studentId}`}
          />
        </TableCell>
        <TableCell className="px-1 py-0.5 align-middle sm:px-2 sm:py-1">
          <div className="flex flex-wrap items-center gap-1.5 min-w-[240px]">
            <LanguageCheckButton
              fields={buildStudentLanguageFields(studentId, [assessmentId])}
              disabled={published}
            />
          <Button
            size="sm"
            className="h-7 px-2 text-[10px] sm:h-8 sm:px-3 sm:text-xs"
            onClick={() => handleManualSave(assessmentId, studentId)}
            disabled={published || entry.isSaving || !entry.isDirty}
            data-testid={`button-save-${assessmentId}-${studentId}`}
          >
            {entry.isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : entry.isDirty ? (
              <>
                <Save className="mr-1 h-4 w-4" />
                Save
              </>
            ) : (
              <>
                <CheckCircle2 className="mr-1 h-4 w-4" />
                Saved
              </>
            )}
          </Button>
          </div>
        </TableCell>
      </>
    );
  };

  return (
    <div className="mx-auto max-w-[1800px] space-y-4 p-2.5 sm:space-y-6 sm:p-4 lg:p-6">
      <div className="flex items-center gap-2 sm:gap-3">
        <FileText
          className="h-6 w-6 sm:h-8 sm:w-8"
          style={{ color: "#1b2a5c" }}
        />
        <div>
          <h1
            className="text-2xl font-bold tracking-tight sm:text-3xl"
            style={{ color: "#1b2a5c" }}
          >
            Marks Entry
          </h1>
          <p className="text-sm text-muted-foreground sm:text-base">
            Enter marks for one or several assessments in the same class and
            subject.
          </p>
        </div>
      </div>

      {validationWarnings.length > 0 && (
        <Alert variant="destructive" data-testid="validation-warning">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {validationWarnings.slice(0, 5).map((warning, index) => (
              <div
                key={`${warning.assessmentId}-${warning.studentId}-${warning.paperId}-${index}`}
              >
                {warning.message}
              </div>
            ))}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="p-3 pb-2 sm:p-5 sm:pb-3">
          <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
            <ClipboardList className="h-4 w-4 sm:h-5 sm:w-5" />
            Select Assessments
          </CardTitle>
          <CardDescription className="text-xs sm:text-sm">
            Choose the academic context, then select one or more assessments.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-3 pb-3 sm:px-5 sm:pb-5">
          <div className="hidden xl:flex xl:flex-wrap xl:items-end xl:gap-4">
            <div className="flex shrink-0 items-end gap-4">
              <div className="w-[100px] min-w-0 space-y-1">
                <Label className="block text-xs sm:text-sm">
                  Academic Year
                </Label>
                <InfiniteYearPicker
                  value={selectedAcademicYear}
                  onValueChange={(value) =>
                    changeFilterSafely(() => setSelectedAcademicYear(value))
                  }
                  placeholder="Year..."
                  className="h-9 w-full text-sm"
                  dataTestId="select-academic-year"
                />
              </div>
              <div className="w-[115px] min-w-0 space-y-1">
                <Label className="block text-xs sm:text-sm">School Term</Label>
                <Select
                  value={selectedTermFilter}
                  onValueChange={(value) =>
                    changeFilterSafely(() => setSelectedTermFilter(value))
                  }
                >
                  <SelectTrigger
                    className="h-9 w-full text-sm"
                    data-testid="select-term-filter"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TERM_OPTIONS.map((term) => (
                      <SelectItem key={term.value} value={term.value}>
                        {term.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-[170px] min-w-0 space-y-1">
                <Label className="block text-xs sm:text-sm">Class</Label>
                <Select
                  value={selectedClassId}
                  onValueChange={(value) =>
                    changeFilterSafely(() => setSelectedClassId(value))
                  }
                >
                  <SelectTrigger
                    className="h-9 w-full text-sm"
                    data-testid="select-class"
                  >
                    <SelectValue placeholder="Select class..." />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredClasses.map((cls) => (
                      <SelectItem key={cls.id} value={String(cls.id)}>
                        {cls.shortCode?.trim() || cls.className}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-[215px] min-w-0 space-y-1">
                <Label className="block text-xs sm:text-sm">Subject</Label>
                <Select
                  value={selectedSubjectId}
                  onValueChange={(value) =>
                    changeFilterSafely(() => setSelectedSubjectId(value))
                  }
                >
                  <SelectTrigger
                    className="h-9 w-full text-sm"
                    data-testid="select-subject"
                  >
                    <SelectValue placeholder="Select subject..." />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredSubjects.map((subject) => (
                      <SelectItem key={subject.id} value={String(subject.id)}>
                        {subject.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-[250px] min-w-0 space-y-1">
                <Label className="block text-xs sm:text-sm">Assessments</Label>
                <Popover
                  open={desktopAssessmentPickerOpen}
                  onOpenChange={setDesktopAssessmentPickerOpen}
                >
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      aria-expanded={desktopAssessmentPickerOpen}
                      disabled={!selectedSubjectId}
                      className="h-9 w-full justify-between overflow-hidden px-3 text-sm font-normal"
                      data-testid="select-assessment"
                    >
                      <span className="truncate">{assessmentTriggerText}</span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[340px] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search assessments..." />
                      <CommandList>
                        <CommandEmpty>No assessments found.</CommandEmpty>
                        <CommandGroup>
                          {assessments.map((assessment) => {
                            const selected = selectedAssessmentIds.includes(
                              String(assessment.id),
                            );
                            return (
                              <CommandItem
                                key={assessment.id}
                                value={`${assessment.name} ${assessment.assessmentDate || ""} ${assessment.id}`}
                                onSelect={() =>
                                  toggleAssessment(String(assessment.id))
                                }
                              >
                                <Check
                                  className={cn(
                                    "h-4 w-4",
                                    selected ? "opacity-100" : "opacity-0",
                                  )}
                                />
                                <span className="min-w-0 flex-1 truncate">
                                  {assessment.name}
                                </span>
                                {assessment.assessmentDate ? (
                                  <span className="truncate text-[9px] text-muted-foreground sm:text-[10px] md:text-xs">
                                    {assessment.assessmentDate}
                                  </span>
                                ) : null}
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      </CommandList>
                      {selectedAssessmentIds.length > 0 && (
                        <div className="border-t p-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="w-full"
                            onClick={clearAssessmentSelection}
                          >
                            <X className="mr-2 h-4 w-4" />
                            Clear selection
                          </Button>
                        </div>
                      )}
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div className="min-w-[280px] flex-[1_1_280px] space-y-1">
              <Label className="block text-xs sm:text-sm">Search Student</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={studentSearch}
                  onChange={(event) => setStudentSearch(event.target.value)}
                  placeholder="Search name or admission no..."
                  className="h-9 w-full pl-9 text-sm"
                  disabled={selectedAssessmentIds.length === 0}
                  data-testid="input-marks-student-search"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 items-end gap-3 xl:hidden sm:grid-cols-3">
            <div className="min-w-0 space-y-1">
              <Label className="block text-xs sm:text-sm">Academic Year</Label>
              <InfiniteYearPicker
                value={selectedAcademicYear}
                onValueChange={(value) =>
                  changeFilterSafely(() => setSelectedAcademicYear(value))
                }
                placeholder="Year..."
                className="h-9 w-full text-sm"
                dataTestId="select-academic-year-mobile"
              />
            </div>
            <div className="min-w-0 space-y-1">
              <Label className="block text-xs sm:text-sm">School Term</Label>
              <Select
                value={selectedTermFilter}
                onValueChange={(value) =>
                  changeFilterSafely(() => setSelectedTermFilter(value))
                }
              >
                <SelectTrigger className="h-9 w-full text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TERM_OPTIONS.map((term) => (
                    <SelectItem key={term.value} value={term.value}>
                      {term.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0 space-y-1">
              <Label className="block text-xs sm:text-sm">Class</Label>
              <Select
                value={selectedClassId}
                onValueChange={(value) =>
                  changeFilterSafely(() => setSelectedClassId(value))
                }
              >
                <SelectTrigger className="h-9 w-full text-sm">
                  <SelectValue placeholder="Select class..." />
                </SelectTrigger>
                <SelectContent>
                  {filteredClasses.map((cls) => (
                    <SelectItem key={cls.id} value={String(cls.id)}>
                      {cls.shortCode?.trim() || cls.className}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0 space-y-1">
              <Label className="block text-xs sm:text-sm">Subject</Label>
              <Select
                value={selectedSubjectId}
                onValueChange={(value) =>
                  changeFilterSafely(() => setSelectedSubjectId(value))
                }
              >
                <SelectTrigger className="h-9 w-full text-sm">
                  <SelectValue placeholder="Select subject..." />
                </SelectTrigger>
                <SelectContent>
                  {filteredSubjects.map((subject) => (
                    <SelectItem key={subject.id} value={String(subject.id)}>
                      {subject.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 min-w-0 space-y-1 sm:col-span-2">
              <Label className="block text-xs sm:text-sm">Assessments</Label>
              <Popover
                open={mobileAssessmentPickerOpen}
                onOpenChange={setMobileAssessmentPickerOpen}
              >
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    disabled={!selectedSubjectId}
                    className="h-9 w-full justify-between overflow-hidden px-3 text-sm font-normal"
                  >
                    <span className="truncate">{assessmentTriggerText}</span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-[min(340px,calc(100vw-1rem))] p-0"
                  align="start"
                >
                  <Command>
                    <CommandInput placeholder="Search assessments..." />
                    <CommandList>
                      <CommandEmpty>No assessments found.</CommandEmpty>
                      <CommandGroup>
                        {assessments.map((assessment) => {
                          const selected = selectedAssessmentIds.includes(
                            String(assessment.id),
                          );
                          return (
                            <CommandItem
                              key={assessment.id}
                              value={`${assessment.name} ${assessment.assessmentDate || ""} ${assessment.id}`}
                              onSelect={() =>
                                toggleAssessment(String(assessment.id))
                              }
                            >
                              <Check
                                className={cn(
                                  "h-4 w-4",
                                  selected ? "opacity-100" : "opacity-0",
                                )}
                              />
                              <span className="min-w-0 flex-1 truncate">
                                {assessment.name}
                              </span>
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                    {selectedAssessmentIds.length > 0 && (
                      <div className="border-t p-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="w-full"
                          onClick={clearAssessmentSelection}
                        >
                          <X className="mr-2 h-4 w-4" />
                          Clear selection
                        </Button>
                      </div>
                    )}
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <div className="col-span-2 space-y-1 sm:col-span-3">
              <Label className="block text-xs sm:text-sm">Search Student</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={studentSearch}
                  onChange={(event) => setStudentSearch(event.target.value)}
                  placeholder="Search name or admission no..."
                  className="h-9 w-full pl-9 text-sm"
                  disabled={selectedAssessmentIds.length === 0}
                />
              </div>
            </div>
          </div>

          {importContextReady && selectedAssessmentIds.length === 0 && (
            <div className="mt-3 flex justify-end border-t pt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={openImportFilePicker}
                disabled={isParsingImport}
              >
                {isParsingImport ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                Upload combined marks workbook
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={handleImportFile}
      />

      {selectedAssessmentIds.length > 0 && (
        <Card>
          <CardHeader className="p-3 pb-2 sm:p-5 sm:pb-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                  <BookOpen className="h-4 w-4 sm:h-5 sm:w-5" />
                  {isMultiAssessmentMode
                    ? "Multiple Assessment Entry"
                    : "Marks Entry"}
                </CardTitle>
                <CardDescription className="text-xs sm:text-sm">
                  {selectedClass?.className} • {selectedSubject?.name} •{" "}
                  {selectedAssessmentIds.length} assessment
                  {selectedAssessmentIds.length === 1 ? "" : "s"}
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {dirtyCount > 0 && (
                  <Badge variant="outline">{dirtyCount} unsaved</Badge>
                )}
                {savingCount > 0 && (
                  <Badge variant="outline">
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    {savingCount} saving
                  </Badge>
                )}
                <LanguageCheckButton
                  fields={allMarksLanguageFields}
                  label="Check Language for All"
                  disabled={!allMarksLanguageFields.length}
                />
                <Button
                  size="sm"
                  className="h-8"
                  onClick={handleSaveAll}
                  disabled={dirtyCount === 0}
                >
                  <Save className="mr-1 h-4 w-4" />
                  Save All Marks
                </Button>
              </div>
            </div>

            <div className="pt-2">
              <div className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-medium">
                    Combined Excel workbook
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {selectedAssessmentIds.length} selected assessment
                    {selectedAssessmentIds.length === 1 ? "" : "s"} in one file
                  </div>
                  <div className="mt-2 flex max-w-full flex-wrap gap-1">
                    {selectedAssessments.map((assessment) => {
                      const published = isAssessmentPublished(assessment.id);
                      return (
                        <Badge
                          key={assessment.id}
                          variant={published ? "default" : "outline"}
                          className={cn("max-w-[260px] truncate text-[10px] sm:text-xs", published && "bg-blue-600 text-white hover:bg-blue-600")}
                        >
                          {assessment.name}{published ? " • Published" : ""}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => downloadCombinedWorkbook(false)}
                    disabled={!combinedActionsReady}
                  >
                    <FileSpreadsheet className="mr-1.5 h-4 w-4" />
                    Template
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => downloadCombinedWorkbook(true)}
                    disabled={!combinedActionsReady}
                  >
                    <Download className="mr-1.5 h-4 w-4" />
                    Download
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={openImportFilePicker}
                    disabled={isParsingImport}
                  >
                    {isParsingImport ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="mr-1.5 h-4 w-4" />
                    )}
                    Upload
                  </Button>
                </div>
              </div>
            </div>
          </CardHeader>

          <CardContent className="px-3 pb-3 pt-0 sm:px-5 sm:pb-5">
            {marksError ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{marksError.message}</AlertDescription>
              </Alert>
            ) : isLoadingMarks ? (
              <div className="space-y-4">
                {[1, 2, 3].map((index) => (
                  <Skeleton key={index} className="h-20 w-full" />
                ))}
              </div>
            ) : displayedStudents.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                <User className="mx-auto mb-4 h-12 w-12 opacity-50" />
                <p>No students found in this class</p>
              </div>
            ) : (
              <>
                <div className="block min-w-0">
                  <div className="relative max-w-full overflow-x-auto overscroll-x-contain rounded-md border touch-pan-x">
                    <Table className="w-max min-w-full table-auto text-[11px] sm:text-xs md:text-sm">
                      <TableHeader>
                        <TableRow>
                          <TableHead
                            rowSpan={2}
                            className="sticky left-0 z-40 w-[126px] min-w-[126px] max-w-[126px] border-r bg-background px-1 py-1 text-[11px] shadow-[2px_0_0_0_hsl(var(--border))] sm:w-[145px] sm:min-w-[145px] sm:max-w-[145px] sm:px-2 sm:text-xs md:w-[170px] md:min-w-[170px] md:max-w-[170px] md:text-sm"
                          >
                            Student
                          </TableHead>
                          {selectedAssessmentNumbers.map((assessmentId) => {
                            const data = marksDataByAssessment[assessmentId];
                            if (!data) return null;
                            return (
                              <TableHead
                                key={assessmentId}
                                colSpan={assessmentColumnCount(
                                  data,
                                  isMultiAssessmentMode,
                                )}
                                className="border-l bg-muted/40 px-1 py-1 text-center sm:px-2 sm:py-2"
                              >
                                <div className="flex max-w-[230px] items-center justify-center gap-1.5 sm:max-w-[310px] md:max-w-[390px]">
                                  <span className="truncate text-[10px] font-semibold leading-tight sm:text-xs md:text-sm">{data.assessment.name}</span>
                                  {data.publication?.isPublished && <Badge className="shrink-0 bg-blue-600 px-1.5 py-0 text-[8px] text-white hover:bg-blue-600 sm:text-[9px]">Published</Badge>}
                                </div>
                              </TableHead>
                            );
                          })}
                          {isMultiAssessmentMode && (
                            <TableHead
                              rowSpan={2}
                              className="min-w-[260px] border-l bg-background px-1 text-center text-[10px] sm:min-w-[300px] sm:px-2 sm:text-xs md:min-w-[330px] md:text-sm"
                            >
                              Action
                            </TableHead>
                          )}
                        </TableRow>
                        <TableRow>
                          {selectedAssessmentNumbers.flatMap((assessmentId) => {
                            const data = marksDataByAssessment[assessmentId];
                            if (!data) return [];
                            const commonColumns = [
                              <TableHead
                                key={`${assessmentId}-status`}
                                className="min-w-[72px] border-l px-1 text-[10px] sm:min-w-[84px] sm:px-2 sm:text-xs md:min-w-[96px] md:text-sm"
                              >
                                Status
                              </TableHead>,
                              ...data.papers.map((paper) => (
                                <TableHead
                                  key={`${assessmentId}-paper-${paper.id}`}
                                  className="min-w-[68px] px-1 text-center text-[10px] leading-tight sm:min-w-[80px] sm:px-2 sm:text-xs md:min-w-[92px] md:text-sm"
                                >
                                  {paper.paperName}
                                  <div className="text-[9px] font-normal text-muted-foreground sm:text-[10px] md:text-xs">
                                    /{paper.paperMarks}
                                  </div>
                                </TableHead>
                              )),
                            ];
                            if (isMultiAssessmentMode) return commonColumns;
                            return [
                              ...commonColumns,
                              <TableHead
                                key={`${assessmentId}-pct`}
                                className="min-w-[48px] px-1 text-center text-[10px] sm:min-w-[56px] sm:px-2 sm:text-xs md:min-w-[62px] md:text-sm"
                              >
                                %
                              </TableHead>,
                              <TableHead
                                key={`${assessmentId}-grade`}
                                className="min-w-[50px] px-1 text-center text-[10px] sm:min-w-[58px] sm:px-2 sm:text-xs md:min-w-[64px] md:text-sm"
                              >
                                Grade
                              </TableHead>,
                              <TableHead
                                key={`${assessmentId}-comment`}
                                className="min-w-[200px] px-1 text-[10px] sm:min-w-[230px] sm:px-2 sm:text-xs md:min-w-[270px] md:text-sm"
                              >
                                Comment
                              </TableHead>,
                              <TableHead
                                key={`${assessmentId}-action`}
                                className="min-w-[70px] px-1 text-[10px] sm:min-w-[78px] sm:px-2 sm:text-xs md:min-w-[88px] md:text-sm"
                              >
                                Action
                              </TableHead>,
                            ];
                          })}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {displayedStudents.map((student) => {
                          const rowSaveState = getStudentRowSaveState(
                            student.id,
                          );
                          return (
                            <TableRow key={student.id}>
                              <TableCell className="sticky left-0 z-30 w-[126px] min-w-[126px] max-w-[126px] border-r bg-background px-1 py-1 font-medium shadow-[2px_0_0_0_hsl(var(--border))] sm:w-[145px] sm:min-w-[145px] sm:max-w-[145px] sm:px-2 md:w-[170px] md:min-w-[170px] md:max-w-[170px]">
                                <div className="flex flex-col leading-tight">
                                  <span className="line-clamp-2 break-words text-[11px] sm:text-xs md:text-sm">
                                    {student.firstName} {student.lastName}
                                  </span>
                                  <span className="truncate text-[9px] text-muted-foreground sm:text-[10px] md:text-xs">
                                    {student.admissionNo}
                                  </span>
                                </div>
                              </TableCell>
                              {selectedAssessmentNumbers.map((assessmentId) => {
                                const data =
                                  marksDataByAssessment[assessmentId];
                                if (!data) return null;
                                const isInRoster = data.students.some(
                                  (item) => item.id === student.id,
                                );
                                if (!isInRoster) {
                                  return (
                                    <TableCell
                                      key={assessmentId}
                                      colSpan={assessmentColumnCount(
                                        data,
                                        isMultiAssessmentMode,
                                      )}
                                      className="border-l px-1 py-1 text-center text-[9px] text-muted-foreground sm:text-xs"
                                    >
                                      Not in assessment roster
                                    </TableCell>
                                  );
                                }
                                return (
                                  <Fragment key={assessmentId}>
                                    {renderAssessmentFields(
                                      assessmentId,
                                      student.id,
                                      false,
                                      isMultiAssessmentMode,
                                    )}
                                  </Fragment>
                                );
                              })}
                              {isMultiAssessmentMode && (
                                <TableCell className="border-l px-1 py-0.5 text-center align-middle sm:px-2 sm:py-1">
                                  <div className="flex flex-wrap items-center justify-center gap-1.5 min-w-[250px]">
                                    <LanguageCheckButton fields={buildStudentLanguageFields(student.id)} />
                                  <Button
                                    size="sm"
                                    className="h-7 px-2 text-[10px] sm:h-8 sm:px-3 sm:text-xs"
                                    onClick={() =>
                                      handleSaveStudentRow(student.id)
                                    }
                                    disabled={
                                      rowSaveState.isSaving ||
                                      !rowSaveState.isDirty
                                    }
                                    data-testid={`button-save-row-${student.id}`}
                                  >
                                    {rowSaveState.isSaving ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : rowSaveState.isDirty ? (
                                      <>
                                        <Save className="mr-1 h-4 w-4" />
                                        Save
                                      </>
                                    ) : (
                                      <>
                                        <CheckCircle2 className="mr-1 h-4 w-4" />
                                        Saved
                                      </>
                                    )}
                                  </Button>
                                  </div>
                                </TableCell>
                              )}
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>

              </>
            )}
          </CardContent>
        </Card>
      )}

      {selectedAssessmentIds.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-8 sm:py-12">
            <div className="text-center text-muted-foreground">
              <AlertCircle className="mx-auto mb-3 h-10 w-10 opacity-50 sm:mb-4 sm:h-12 sm:w-12" />
              <p className="text-base font-medium sm:text-lg">
                No assessments selected
              </p>
              <p className="text-sm">
                Select a class, subject, and one or more assessments above to
                start entering marks.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog
        open={Boolean(pendingImport)}
        onOpenChange={(open) => {
          if (!open && !isApplyingImport) {
            setPendingImport(null);
            setSelectedImportAssessmentIds([]);
          }
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-hidden p-0">
          <DialogHeader className="border-b px-5 py-4">
            <DialogTitle>Import assessment marks</DialogTitle>
            <DialogDescription>
              {pendingImport
                ? `${pendingImport.fileName} contains ${pendingImport.assessments.length} assessment${pendingImport.assessments.length === 1 ? "" : "s"}. Choose which ones to import.`
                : "Review the assessments found in the workbook."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between border-b px-5 py-3 text-sm">
            <span className="text-muted-foreground">
              All assessments with valid records are selected by default.
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setSelectedImportAssessmentIds(
                    pendingImport?.assessments
                      .filter((item) => item.recordCount > 0 && !item.isPublished)
                      .map((item) => item.assessmentId) || [],
                  )
                }
              >
                Select all
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSelectedImportAssessmentIds([])}
              >
                Clear all
              </Button>
            </div>
          </div>

          <div className="max-h-[52vh] space-y-2 overflow-y-auto px-5 py-4">
            {pendingImport?.assessments.map((item) => {
              const checked = selectedImportAssessmentIds.includes(
                item.assessmentId,
              );
              const disabled = item.recordCount === 0 || item.isPublished;
              return (
                <button
                  key={item.assessmentId}
                  type="button"
                  disabled={disabled || isApplyingImport}
                  onClick={() => toggleImportAssessment(item.assessmentId)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                    checked
                      ? "border-primary/50 bg-primary/5"
                      : "bg-background",
                    disabled
                      ? "cursor-not-allowed opacity-50"
                      : "hover:bg-muted/50",
                  )}
                >
                  <Checkbox
                    checked={checked}
                    disabled={disabled || isApplyingImport}
                    onCheckedChange={() =>
                      toggleImportAssessment(item.assessmentId)
                    }
                    onClick={(event) => event.stopPropagation()}
                    aria-label={`Import ${item.name}`}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{item.name}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {item.paperCount} paper{item.paperCount === 1 ? "" : "s"}
                      </Badge>
                      {item.isPublished && <Badge className="bg-blue-600 text-[10px] text-white hover:bg-blue-600">Published — locked</Badge>}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {item.recordCount} valid student record
                      {item.recordCount === 1 ? "" : "s"}
                      {item.skippedCount > 0
                        ? ` • ${item.skippedCount} invalid or unmatched skipped`
                        : ""}
                    </div>
                    <div className="mt-1 text-xs">
                      {item.isPublished ? (
                        <span className="text-muted-foreground">Published — locked and excluded from import</span>
                      ) : item.isCurrentlySelected ? (
                        <span className="text-green-700 dark:text-green-400">Already displayed</span>
                      ) : (
                        <span className="text-blue-700 dark:text-blue-400">Will be added to the Marks Entry view</span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <DialogFooter className="border-t px-5 py-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPendingImport(null);
                setSelectedImportAssessmentIds([]);
              }}
              disabled={isApplyingImport}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={applyPendingImport}
              disabled={
                selectedImportAssessmentIds.length === 0 || isApplyingImport
              }
            >
              {isApplyingImport ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              Import {selectedImportAssessmentIds.length} assessment
              {selectedImportAssessmentIds.length === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
