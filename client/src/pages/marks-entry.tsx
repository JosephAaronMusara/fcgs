import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, schoolFetch } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InfiniteYearPicker } from "@/components/ui/infinite-year-picker";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Save, AlertCircle, CheckCircle2, User, BookOpen, ClipboardList, Download, Upload, FileSpreadsheet, AlertTriangle, Loader2, FileText, Search } from "lucide-react";
import * as XLSX from "xlsx";
import type { Assessment, Subject, Class as ClassType, Student, Grade, AssessmentComment } from "@shared/schema";
import { useAuth } from "@/lib/auth";

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

interface MarksEntryData {
  assessment: Assessment;
  papers: AssessmentPaper[];
  students: Student[];
  marksByStudent: Record<number, AssessmentMark>;
  grades: Grade[];
  comments: AssessmentComment[];
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
}

interface ValidationWarning {
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

const TERM_OPTIONS = [
  { value: "none", label: "All Terms" },
  { value: "term1", label: "Term 1" },
  { value: "vac1", label: "Vacation 1" },
  { value: "term2", label: "Term 2" },
  { value: "vac2", label: "Vacation 2" },
  { value: "term3", label: "Term 3" },
];


export default function MarksEntryPage() {
  const { toast } = useToast();
  const { currentSchoolId, user } = useAuth();
  const schoolScopeId = currentSchoolId || user?.schoolId || null;
  const isTeacherScoped = user?.role === "teacher" || user?.role === "assistant_teacher";
  const currentYear = new Date().getFullYear();
  const [selectedAcademicYear, setSelectedAcademicYear] = useState<string>(String(currentYear));
  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>("");
  const [selectedTermFilter, setSelectedTermFilter] = useState<string>("none");
  const [selectedAssessmentId, setSelectedAssessmentId] = useState<string>("");
  const [studentSearch, setStudentSearch] = useState("");
  const [studentMarks, setStudentMarks] = useState<Record<number, StudentMarkState>>({});
  const studentMarksRef = useRef<Record<number, StudentMarkState>>({});
  const [validationWarnings, setValidationWarnings] = useState<ValidationWarning[]>([]);
  const autoSaveTimers = useRef<Record<number, NodeJS.Timeout>>({});
  const savingStudents = useRef<Set<number>>(new Set());
  const marksDataRef = useRef<MarksEntryData | null>(null);
  const selectedAssessmentIdRef = useRef<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  const currentStaffAssignments: StaffAssignment[] = Array.isArray(currentStaffAssignmentsResponse)
    ? currentStaffAssignmentsResponse
    : (currentStaffAssignmentsResponse?.items ?? []);

  const teacherAssignmentsWithClass = useMemo(
    () => (currentStaffAssignments || []).filter((row) => row.classId !== null && row.classId !== undefined),
    [currentStaffAssignments],
  );

  const filteredClasses = useMemo(() => {
    if (!isTeacherScoped) return classes || [];
    return (classes || []).filter((cls) => {
      const classMatchesTeacher = teacherAssignmentsWithClass.some((row) => Number(row.classId) === cls.id);
      if (!classMatchesTeacher) return false;
      if (!selectedSubjectId) return true;
      return teacherAssignmentsWithClass.some((row) =>
        Number(row.classId) === cls.id && Number(row.subjectId) === Number(selectedSubjectId)
      );
    });
  }, [classes, isTeacherScoped, teacherAssignmentsWithClass, selectedSubjectId]);

  const classCompatibleSubjects = useMemo(() => {
    if (!subjects) return [];
    if (!selectedClassId) return subjects;
    const subjectIds = new Set((classSubjectRows || []).filter((row) => row.classId === Number(selectedClassId)).map((row) => row.subjectId));
    return subjectIds.size > 0
      ? subjects.filter((subject) => subjectIds.has(subject.id))
      : subjects;
  }, [selectedClassId, subjects, classSubjectRows]);

  const filteredSubjects = useMemo(() => {
    if (!isTeacherScoped) return classCompatibleSubjects;
    return classCompatibleSubjects.filter((subject) => {
      if (!selectedClassId) {
        return teacherAssignmentsWithClass.some((row) => Number(row.subjectId) === subject.id);
      }
      return teacherAssignmentsWithClass.some((row) =>
        Number(row.classId) === Number(selectedClassId) && Number(row.subjectId) === subject.id
      );
    });
  }, [classCompatibleSubjects, isTeacherScoped, teacherAssignmentsWithClass, selectedClassId]);

  useEffect(() => {
    if (selectedClassId && !filteredClasses.some((cls) => String(cls.id) === selectedClassId)) {
      setSelectedClassId("");
      setSelectedAssessmentId("");
    }
  }, [selectedClassId, filteredClasses]);

  useEffect(() => {
    if (selectedSubjectId && !filteredSubjects.some((subject) => String(subject.id) === selectedSubjectId)) {
      setSelectedSubjectId("");
      setSelectedAssessmentId("");
    }
  }, [selectedSubjectId, filteredSubjects]);

  const { data: assessments } = useQuery<Assessment[]>({
    queryKey: ["/api/assessments", schoolScopeId, selectedAcademicYear, selectedClassId, selectedSubjectId, selectedTermFilter],
    queryFn: async () => {
      if (!selectedClassId || !selectedSubjectId) return [];
      const params = new URLSearchParams();
      params.set("academicYear", selectedAcademicYear);
      params.set("classId", selectedClassId);
      params.set("subjectId", selectedSubjectId);
      if (selectedTermFilter !== "none") params.set("termFilter", selectedTermFilter);
      const res = await schoolFetch(`/api/assessments?${params}`);
      if (!res.ok) throw new Error("Failed to fetch assessments");
      return res.json();
    },
    enabled: !!schoolScopeId && !!selectedClassId && !!selectedSubjectId,
  });

  const { data: marksData, isLoading: isLoadingMarks } = useQuery<MarksEntryData>({
    queryKey: ["/api/marks-entry", selectedAssessmentId],
    enabled: !!selectedAssessmentId,
  });

  const getPoolComment = useCallback((gradeId: number | null): string => {
    if (!gradeId || !marksData?.comments) return "";
    const exact = marksData.comments.find(c => c.gradeId === gradeId);
    if (exact?.commentText) return exact.commentText;

    const gradeName = marksData.grades.find((grade) => grade.id === gradeId)?.gradeName?.trim().toUpperCase();
    if (!gradeName) return "";

    const fallback = marksData.comments.find((comment: any) => {
      const commentGradeName = marksData.grades.find((grade) => grade.id === comment.gradeId)?.gradeName?.trim().toUpperCase();
      return commentGradeName === gradeName;
    });
    return fallback?.commentText || "";
  }, [marksData?.comments, marksData?.grades]);

  const calculatePercentageAndGrade = useCallback((paperMarks: Record<number, string>): { 
    percentage: number | null; 
    gradeName: string; 
    gradeId: number | null 
  } => {
    if (!marksData) return { percentage: null, gradeName: "", gradeId: null };
    
    const { papers, grades } = marksData;
    let totalWeightedScore = 0;
    let totalWeight = 0;
    let hasAnyMark = false;
    
    for (const paper of papers) {
      const markStr = paperMarks[paper.id];
      if (markStr && markStr !== "") {
        hasAnyMark = true;
        const markVal = parseFloat(markStr);
        if (!isNaN(markVal)) {
          const markPct = (markVal / paper.paperMarks) * 100;
          const weight = parseFloat(paper.paperWeightPct);
          totalWeightedScore += (markPct * weight) / 100;
          totalWeight += weight;
        }
      }
    }
    
    if (!hasAnyMark) return { percentage: null, gradeName: "", gradeId: null };
    
    const percentage = totalWeight > 0 ? Math.round(totalWeightedScore) : null;
    
    let gradeName = "";
    let gradeId: number | null = null;
    if (percentage !== null) {
      const orderedGrades = [...grades].sort((a, b) => Number(b.upperLimit) - Number(a.upperLimit));
      for (const grade of orderedGrades) {
        const lower = Number(grade.lowerLimit);
        const upper = Number(grade.upperLimit);
        if (Number.isNaN(lower) || Number.isNaN(upper)) continue;
        if (percentage >= lower && percentage <= upper) {
          gradeName = grade.gradeName;
          gradeId = grade.id;
          break;
        }
      }
    }
    
    return { percentage, gradeName, gradeId };
  }, [marksData]);


  const hasAnyMarks = useCallback((paperMarks: Record<number, string>): boolean => {
    return Object.values(paperMarks).some(v => v !== "" && v !== undefined);
  }, []);

  useEffect(() => {
    if (marksData) {
      const initialMarks: Record<number, StudentMarkState> = {};
      for (const student of marksData.students) {
        const existingMark = marksData.marksByStudent[student.id];
        const paperMarks: Record<number, string> = {};
        
        for (const paper of marksData.papers) {
          const existingPaperMark = existingMark?.paperMarks?.find(
            (pm) => pm.assessmentPaperId === paper.id
          );
          if (existingPaperMark?.markObtained !== undefined && existingPaperMark?.markObtained !== null && existingPaperMark.markObtained !== "") {
            const numericMark = Number(existingPaperMark.markObtained);
            paperMarks[paper.id] = Number.isFinite(numericMark) ? String(Math.round(numericMark)) : String(existingPaperMark.markObtained);
          } else {
            paperMarks[paper.id] = "";
          }
        }
        
        initialMarks[student.id] = {
          paperMarks,
          attStatus: existingMark?.attStatus || "none",
          commentSource: existingMark?.commentSource || "pool",
          customCommentText: existingMark?.customCommentText || "",
          autoCommentSnapshot: existingMark?.autoCommentSnapshot || "",
          isDirty: false,
          isSaving: false,
          validationError: null,
        };
      }
      setStudentMarks(initialMarks);
      setValidationWarnings([]);
    }
  }, [marksData]);

  useEffect(() => {
    setStudentSearch("");
  }, [selectedAssessmentId]);

  const displayedStudents = useMemo(() => {
    const students = marksData?.students || [];
    const term = studentSearch.trim().toLowerCase();
    if (!term) return students;
    return students.filter((student) => {
      const studentName = `${student.firstName || ""} ${student.lastName || ""}`.trim().toLowerCase();
      return studentName.includes(term) || String(student.admissionNo || "").toLowerCase().includes(term);
    });
  }, [marksData?.students, studentSearch]);

  useEffect(() => {
    studentMarksRef.current = studentMarks;
  }, [studentMarks]);

  useEffect(() => {
    marksDataRef.current = marksData || null;
  }, [marksData]);

  useEffect(() => {
    selectedAssessmentIdRef.current = selectedAssessmentId;
  }, [selectedAssessmentId]);

  useEffect(() => {
    return () => {
      for (const timer of Object.values(autoSaveTimers.current)) {
        clearTimeout(timer);
      }
      autoSaveTimers.current = {};
    };
  }, []);

  useEffect(() => {
    for (const timer of Object.values(autoSaveTimers.current)) {
      clearTimeout(timer);
    }
    autoSaveTimers.current = {};
  }, [selectedAssessmentId]);

  const saveMutationRef = useRef<any>(null);

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/marks-entry", data);
      return res.json();
    },
    onSuccess: (data, variables) => {
      savingStudents.current.delete(variables.studentId);
      setStudentMarks((prev) => ({
        ...prev,
        [variables.studentId]: {
          ...prev[variables.studentId],
          isDirty: false,
          isSaving: false,
          autoCommentSnapshot: data.autoCommentSnapshot || prev[variables.studentId]?.autoCommentSnapshot,
        },
      }));
      queryClient.setQueryData(["/api/marks-entry", String(variables.assessmentId)], (old: MarksEntryData | undefined) => {
        if (!old) return old;
        return {
          ...old,
          marksByStudent: {
            ...old.marksByStudent,
            [variables.studentId]: {
              id: data.id,
              studentId: variables.studentId,
              percentage: data.percentage,
              gradeId: data.gradeId,
              attStatus: data.attStatus || variables.attStatus,
              commentSource: data.commentSource || variables.commentSource,
              customCommentText: data.customCommentText,
              autoCommentSnapshot: data.autoCommentSnapshot,
              paperMarks: (data.paperMarks || []).map((pm: any) => ({
                assessmentPaperId: pm.assessmentPaperId,
                markObtained: pm.markObtained,
              })),
            },
          },
        };
      });
      setTimeout(() => {
        const latestMark = studentMarksRef.current[variables.studentId];
        if (latestMark?.isDirty) {
          doSave(variables.studentId);
        }
      }, 100);
    },
    onError: (error: Error, variables) => {
      savingStudents.current.delete(variables.studentId);
      setStudentMarks((prev) => ({
        ...prev,
        [variables.studentId]: {
          ...prev[variables.studentId],
          isSaving: false,
        },
      }));
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  saveMutationRef.current = saveMutation;

  const doSave = useCallback((studentId: number) => {
    const currentMarks = studentMarksRef.current;
    const studentMark = currentMarks[studentId];
    const currentMarksData = marksDataRef.current;
    const currentAssessmentId = selectedAssessmentIdRef.current;
    
    if (!studentMark || !studentMark.isDirty || !currentMarksData || !currentAssessmentId) return;
    if (savingStudents.current.has(studentId)) return;
    if (!saveMutationRef.current) return;
    
    const paperMarks = currentMarksData.papers.map((paper) => ({
      assessmentPaperId: paper.id,
      markObtained: studentMark.paperMarks[paper.id] ? parseFloat(studentMark.paperMarks[paper.id]) : null,
    }));
    
    savingStudents.current.add(studentId);
    setStudentMarks((prev) => ({
      ...prev,
      [studentId]: { ...prev[studentId], isSaving: true },
    }));
    
    saveMutationRef.current.mutate({
      assessmentId: parseInt(currentAssessmentId),
      studentId,
      paperMarks,
      attStatus: studentMark.attStatus,
      commentSource: studentMark.commentSource,
      customCommentText: studentMark.commentSource === "custom" ? studentMark.customCommentText : null,
      autoCommentSnapshot: studentMark.autoCommentSnapshot,
    });
  }, []);

  const triggerAutoSave = useCallback((studentId: number) => {
    if (autoSaveTimers.current[studentId]) {
      clearTimeout(autoSaveTimers.current[studentId]);
    }
    
    autoSaveTimers.current[studentId] = setTimeout(() => {
      doSave(studentId);
    }, 1500);
  }, [doSave]);

  const recalculateRow = useCallback((studentId: number, newPaperMarks: Record<number, string>, newAttStatus: string): Partial<StudentMarkState> => {
    const hasMark = hasAnyMarks(newPaperMarks);
    const currentState = studentMarks[studentId] || {};
    
    if (!hasMark) {
      return {
        attStatus: "none",
        commentSource: "pool",
        customCommentText: "",
        autoCommentSnapshot: "",
      };
    }
    
    let status = newAttStatus;
    if (hasMark && status === "none") {
      status = "present";
    }
    
    if (status !== "present") {
      return {
        attStatus: status,
        commentSource: "pool",
        customCommentText: currentState.commentSource === "custom" ? currentState.customCommentText : "",
        autoCommentSnapshot: "",
      };
    }
    
    const { gradeId } = calculatePercentageAndGrade(newPaperMarks);
    const poolComment = getPoolComment(gradeId);
    
    if (currentState.commentSource === "custom") {
      return {
        attStatus: status,
        autoCommentSnapshot: poolComment,
      };
    }
    
    return {
      attStatus: status,
      commentSource: "pool",
      customCommentText: poolComment,
      autoCommentSnapshot: poolComment,
    };
  }, [studentMarks, hasAnyMarks, calculatePercentageAndGrade, getPoolComment]);

  const handlePaperMarkChange = (studentId: number, paperId: number, rawValue: string) => {
    if (!marksData) return;

    const value = rawValue.replace(/[^0-9]/g, "");
    if (rawValue !== value) {
      setValidationWarnings(prev => [
        ...prev.filter(w => !(w.studentId === studentId && w.paperId === paperId)),
        { studentId, paperId, message: "Marks must be whole numbers only" }
      ]);
      return;
    }

    const paper = marksData.papers.find(p => p.id === paperId);
    if (paper && value !== "") {
      const numVal = parseInt(value, 10);
      if (!Number.isNaN(numVal) && numVal > paper.paperMarks) {
        setValidationWarnings(prev => [
          ...prev.filter(w => !(w.studentId === studentId && w.paperId === paperId)),
          { studentId, paperId, message: `Mark cannot exceed ${paper.paperMarks}` }
        ]);
        return;
      }
    }

    setValidationWarnings(prev => prev.filter(w => !(w.studentId === studentId && w.paperId === paperId)));

    const currentMark = studentMarks[studentId];
    const newPaperMarks = {
      ...currentMark?.paperMarks,
      [paperId]: value,
    };

    const updates = recalculateRow(studentId, newPaperMarks, currentMark?.attStatus || "none");
    
    setStudentMarks((prev) => ({
      ...prev,
      [studentId]: {
        ...prev[studentId],
        paperMarks: newPaperMarks,
        ...updates,
        isDirty: true,
      },
    }));
    
    triggerAutoSave(studentId);
  };

  const handleAttStatusChange = (studentId: number, value: string) => {
    const currentMark = studentMarks[studentId];
    
    // Clear paper marks if status changes to absent/sick/excused
    const shouldClearMarks = value !== "present" && value !== "none";
    const clearedPaperMarks: Record<number, string> = {};
    if (shouldClearMarks && marksData) {
      for (const paper of marksData.papers) {
        clearedPaperMarks[paper.id] = "";
      }
    }
    
    const paperMarksToUse = shouldClearMarks ? clearedPaperMarks : (currentMark?.paperMarks || {});
    const updates = recalculateRow(studentId, paperMarksToUse, value);
    
    setStudentMarks((prev) => ({
      ...prev,
      [studentId]: {
        ...prev[studentId],
        paperMarks: shouldClearMarks ? clearedPaperMarks : prev[studentId]?.paperMarks || {},
        attStatus: value,
        ...updates,
        isDirty: true,
      },
    }));
    
    triggerAutoSave(studentId);
  };

  const handleCustomCommentChange = (studentId: number, value: string) => {
    if (value.trim() === "") {
      setStudentMarks((prev) => ({
        ...prev,
        [studentId]: {
          ...prev[studentId],
          customCommentText: "",
          commentSource: "pool",
          isDirty: true,
        },
      }));
    } else {
      setStudentMarks((prev) => ({
        ...prev,
        [studentId]: {
          ...prev[studentId],
          customCommentText: value,
          commentSource: "custom",
          isDirty: true,
        },
      }));
    }
    
    triggerAutoSave(studentId);
  };

  const handleManualSave = (studentId: number) => {
    if (autoSaveTimers.current[studentId]) {
      clearTimeout(autoSaveTimers.current[studentId]);
    }
    savingStudents.current.delete(studentId);
    doSave(studentId);
  };

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

  const buildExcelData = (includeMarks: boolean): any[][] | null => {
    if (!marksData || !selectedAssessment) return null;

    const papers = marksData.papers;
    const headerCols: any[] = ["Student ID", "Student Name"];
    const row0: any[] = [...headerCols];
    const row1: any[] = [...headerCols.map(() => "")];
    const row2: any[] = [...headerCols.map(() => "")];
    const row3: any[] = [...headerCols.map(() => "")];
    const row4: any[] = [...headerCols.map(() => "")];

    for (const paper of papers) {
      row0.push(selectedAssessment.name || "Assessment");
      const dateStr = selectedAssessment.createdAt
        ? new Date(selectedAssessment.createdAt).toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
        : "";
      row1.push(dateStr);
      row2.push(`Type ${(selectedAssessment as any).examType || "exam"}`);
      row3.push(`${paper.paperName}-${paper.id}`);
      row4.push(`Out of: ${paper.paperMarks} marks`);
    }

    const rows: any[][] = [row0, row1, row2, row3, row4];

    for (const student of marksData.students) {
      const row: any[] = [
        student.id,
        `${student.lastName} ${student.firstName}`,
      ];
      for (const paper of papers) {
        if (includeMarks) {
          const mark = studentMarks[student.id];
          const val = mark?.paperMarks[paper.id] || "";
          row.push(val === "" ? "" : Number(val));
        } else {
          row.push("");
        }
      }
      rows.push(row);
    }

    return rows;
  };

  const downloadExcel = (rows: any[][], filename: string) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Student Marks");

    const colWidths = [
      { wch: 12 },
      { wch: 28 },
    ];
    if (marksData) {
      for (const _ of marksData.papers) {
        colWidths.push({ wch: 18 });
      }
    }
    ws["!cols"] = colWidths;

    XLSX.writeFile(wb, filename);
  };

  const handleExportCSV = () => {
    const rows = buildExcelData(true);
    if (!rows) return;
    const className = selectedClass?.className?.replace(/\s+/g, "_") || "class";
    const subjectName = selectedSubject?.name?.replace(/\s+/g, "_") || "subject";
    const assessmentName = selectedAssessment?.name?.replace(/\s+/g, "_") || "assessment";
    downloadExcel(rows, `Marks_Entry_${className}_${subjectName}_${assessmentName}.xlsx`);
  };

  const handleDownloadTemplate = () => {
    const rows = buildExcelData(false);
    if (!rows) return;
    const className = selectedClass?.className?.replace(/\s+/g, "_") || "class";
    const subjectName = selectedSubject?.name?.replace(/\s+/g, "_") || "subject";
    const assessmentName = selectedAssessment?.name?.replace(/\s+/g, "_") || "assessment";
    downloadExcel(rows, `Marks_Template_${className}_${subjectName}_${assessmentName}.xlsx`);
  };

  const handleImportCSV = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !marksData) return;

    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data: (string | number | null)[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

      if (data.length < 6) {
        toast({ title: "Error", description: "File does not have enough rows. Expected header rows + student data.", variant: "destructive" });
        return;
      }

      const paperRow = data[3];
      const paperColumnMap: Record<number, number> = {};

      for (let col = 2; col < (paperRow?.length || 0); col++) {
        const cellVal = String(paperRow[col] || "");
        const match = cellVal.match(/-(\d+)$/);
        if (match) {
          const paperId = parseInt(match[1]);
          const paper = marksData.papers.find(p => p.id === paperId);
          if (paper) {
            paperColumnMap[col] = paper.id;
          }
        }
      }

      if (Object.keys(paperColumnMap).length === 0) {
        for (let j = 0; j < marksData.papers.length; j++) {
          paperColumnMap[2 + j] = marksData.papers[j].id;
        }
      }

      let importCount = 0;
      let errorCount = 0;
      const DATA_START_ROW = 5;

      for (let i = DATA_START_ROW; i < data.length; i++) {
        const row = data[i];
        if (!row || row.length < 2) continue;

        const studentIdVal = row[0];
        const studentNameVal = String(row[1] || "").trim();
        if (!studentIdVal && !studentNameVal) continue;

        let student: Student | undefined;
        if (studentIdVal && !isNaN(Number(studentIdVal))) {
          student = marksData.students.find(s => s.id === Number(studentIdVal));
        }
        if (!student && studentNameVal) {
          const nameLower = studentNameVal.toLowerCase();
          student = marksData.students.find(s => {
            const fullName = `${s.lastName} ${s.firstName}`.toLowerCase();
            const fullNameAlt = `${s.firstName} ${s.lastName}`.toLowerCase();
            return fullName === nameLower || fullNameAlt === nameLower;
          });
        }

        if (!student) {
          errorCount++;
          continue;
        }

        const paperMarks: Record<number, string> = {};
        let hasValidMark = true;

        for (const [colStr, paperId] of Object.entries(paperColumnMap)) {
          const col = parseInt(colStr);
          const paper = marksData.papers.find(p => p.id === paperId);
          if (!paper) continue;

          const cellVal = row[col];
          const markValue = cellVal !== null && cellVal !== undefined && cellVal !== "" ? String(cellVal).trim() : "";

          if (markValue !== "") {
            const numVal = parseFloat(markValue);
            if (isNaN(numVal) || numVal < 0 || numVal > paper.paperMarks) {
              hasValidMark = false;
              errorCount++;
              break;
            }
            paperMarks[paperId] = String(numVal);
          } else {
            paperMarks[paperId] = "";
          }
        }

        if (!hasValidMark) continue;

        const hasMark = Object.values(paperMarks).some(v => v !== "");
        const status = hasMark ? "present" : "none";
        const updates = recalculateRow(student.id, paperMarks, status);

        setStudentMarks((prev) => ({
          ...prev,
          [student!.id]: {
            ...prev[student!.id],
            paperMarks,
            ...updates,
            isDirty: true,
          },
        }));

        importCount++;
        triggerAutoSave(student.id);
      }

      toast({
        title: "Import Complete",
        description: `Imported ${importCount} student marks${errorCount > 0 ? `, ${errorCount} rows skipped (unmatched or invalid)` : ""}`,
      });
    } catch (err: any) {
      toast({ title: "Import Error", description: err.message || "Failed to read file", variant: "destructive" });
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const selectedClass = classes?.find((c) => c.id === parseInt(selectedClassId));
  const selectedSubject = subjects?.find((s) => s.id === parseInt(selectedSubjectId));
  const selectedAssessment = assessments?.find((a) => a.id === parseInt(selectedAssessmentId));

  return (
    <div className="p-2.5 sm:p-4 lg:p-6 space-y-4 sm:space-y-6 max-w-[1600px] mx-auto">
      <div className="flex items-center gap-2 sm:gap-3">
        <FileText className="h-6 w-6 sm:h-8 sm:w-8" style={{ color: "#1b2a5c" }} />
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight" style={{ color: "#1b2a5c" }}>Marks Entry</h1>
          <p className="text-sm sm:text-base text-muted-foreground">
            Enter student marks for assessments. Select academic year, class, subject, term, and assessment to begin.
          </p>
        </div>
      </div>

      {validationWarnings.length > 0 && (
        <Alert variant="destructive" data-testid="validation-warning">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {validationWarnings.map((w, i) => (
              <div key={i}>{w.message}</div>
            ))}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="p-3 pb-2 sm:p-5 sm:pb-3">
          <CardTitle className="text-base sm:text-lg flex items-center gap-2">
            <ClipboardList className="h-4 w-4 sm:h-5 sm:w-5" />
            Select Assessment
          </CardTitle>
          <CardDescription className="text-xs sm:text-sm">Choose which assessment you want to enter marks for</CardDescription>
        </CardHeader>
        <CardContent className="px-3 pb-3 sm:px-5 sm:pb-5">
          <div className="grid grid-cols-3 gap-x-3 gap-y-2 sm:gap-4 items-end lg:grid-cols-[150px_170px_minmax(190px,0.95fr)_minmax(240px,1.15fr)_minmax(280px,1.25fr)_minmax(280px,1.4fr)]">
            <div className="space-y-1 col-span-1 lg:col-span-1 min-w-0">
              <Label className="block text-xs sm:text-sm">Academic Year</Label>
              <InfiniteYearPicker
                value={selectedAcademicYear}
                onValueChange={(value) => {
                  setSelectedAcademicYear(value);
                  setSelectedAssessmentId("");
                }}
                placeholder="Academic year..."
                className="w-full h-8 sm:h-9 text-xs sm:text-sm"
                dataTestId="select-academic-year"
              />
            </div>

            <div className="space-y-1 col-span-1 lg:col-span-1 min-w-0">
              <Label className="block text-xs sm:text-sm">School Term</Label>
              <Select
                value={selectedTermFilter}
                onValueChange={(value) => {
                  setSelectedTermFilter(value);
                  setSelectedAssessmentId("");
                }}
              >
                <SelectTrigger className="w-full h-8 sm:h-9 text-xs sm:text-sm" data-testid="select-term-filter">
                  <SelectValue placeholder="School term..." />
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

            <div className="space-y-1 col-span-1 lg:col-span-1 min-w-0">
              <Label className="block text-xs sm:text-sm">Class</Label>
              <Select
                value={selectedClassId}
                onValueChange={(value) => {
                  setSelectedClassId(value);
                  setSelectedAssessmentId("");
                }}
              >
                <SelectTrigger className="w-full h-8 sm:h-9 text-xs sm:text-sm" data-testid="select-class">
                  <SelectValue placeholder="Select class..." />
                </SelectTrigger>
                <SelectContent>
                  {filteredClasses.map((cls) => (
                    <SelectItem key={cls.id} value={cls.id.toString()}>
                      {cls.shortCode?.trim() || cls.className}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1 col-span-1 lg:col-span-1 min-w-0">
              <Label className="block text-xs sm:text-sm">Subject</Label>
              <Select
                value={selectedSubjectId}
                onValueChange={(value) => {
                  setSelectedSubjectId(value);
                  setSelectedAssessmentId("");
                }}
              >
                <SelectTrigger className="w-full h-8 sm:h-9 text-xs sm:text-sm" data-testid="select-subject">
                  <SelectValue placeholder="Select subject..." />
                </SelectTrigger>
                <SelectContent>
                  {filteredSubjects?.map((sub) => (
                    <SelectItem key={sub.id} value={sub.id.toString()}>
                      {sub.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1 col-span-2 lg:col-span-1 min-w-0">
              <Label className="block text-xs sm:text-sm">Assessment</Label>
              <Select
                value={selectedAssessmentId}
                onValueChange={setSelectedAssessmentId}
                disabled={!selectedSubjectId}
              >
                <SelectTrigger className="w-full h-8 sm:h-9 text-xs sm:text-sm" data-testid="select-assessment">
                  <SelectValue placeholder="Select assessment..." />
                </SelectTrigger>
                <SelectContent>
                  {assessments?.map((assessment) => (
                    <SelectItem key={assessment.id} value={assessment.id.toString()}>
                      {assessment.name}{assessment.assessmentDate ? ` • ${assessment.assessmentDate}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1 col-span-3 lg:col-span-1 min-w-0">
              <Label className="block text-xs sm:text-sm">Search Student</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground sm:left-3 sm:h-4 sm:w-4" />
                <Input
                  value={studentSearch}
                  onChange={(e) => setStudentSearch(e.target.value)}
                  placeholder="Search name or admission no..."
                  className="pl-8 sm:pl-9 w-full h-8 sm:h-9 text-xs sm:text-sm"
                  disabled={!selectedAssessmentId}
                  data-testid="input-marks-student-search"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {selectedAssessmentId && (
        <Card>
          <CardHeader className="p-3 pb-2 sm:p-5 sm:pb-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
              <div>
                <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                  <BookOpen className="h-4 w-4 sm:h-5 sm:w-5" />
                  {selectedAssessment?.name}
                </CardTitle>
                <CardDescription className="text-xs sm:text-sm">
                  {selectedClass?.className} • {selectedSubject?.name}
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-1.5 sm:gap-2">
                {marksData?.papers.map((paper) => (
                  <Badge key={paper.id} variant="outline" className="text-xs">
                    {paper.paperName}: {paper.paperMarks} marks ({paper.paperWeightPct}%)
                  </Badge>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 pt-2 sm:pt-3">
              <Button variant="outline" size="sm" className="h-8 px-2.5 text-xs sm:px-3" onClick={handleDownloadTemplate} data-testid="button-download-template">
                <FileSpreadsheet className="h-4 w-4 mr-1" />
                Template
              </Button>
              <Button variant="outline" size="sm" className="h-8 px-2.5 text-xs sm:px-3" onClick={handleExportCSV} data-testid="button-export-csv">
                <Download className="h-4 w-4 mr-1" />
                Download
              </Button>
              <Button variant="outline" size="sm" className="h-8 px-2.5 text-xs sm:px-3" onClick={() => fileInputRef.current?.click()} data-testid="button-import-csv">
                <Upload className="h-4 w-4 mr-1" />
                Upload
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={handleImportCSV}
                data-testid="input-import-file"
              />
            </div>
          </CardHeader>
          <CardContent className="px-3 pb-3 pt-0 sm:px-5 sm:pb-5">
            {isLoadingMarks ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : displayedStudents.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <User className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No students found in this class</p>
              </div>
            ) : (
              <div className="relative overflow-x-auto rounded-md border sm:border-0">
                <Table className="w-max table-auto text-xs sm:min-w-full sm:text-sm">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky left-0 z-30 min-w-[118px] w-[118px] bg-background border-r px-1.5 py-1 h-7 sm:min-w-[150px] sm:w-[150px] sm:px-2 sm:h-8">Student</TableHead>
                      <TableHead className="min-w-[54px] w-[54px] px-1 py-1 h-7 sm:min-w-[76px] sm:w-[76px] sm:px-2 sm:h-8">Status</TableHead>
                      {marksData?.papers.map((paper) => (
                        <TableHead key={paper.id} className="min-w-[58px] w-[58px] text-center px-1 py-1 h-7 sm:min-w-[82px] sm:w-[82px] sm:px-2 sm:h-8">
                          {paper.paperName}
                          <div className="text-[10px] sm:text-xs font-normal text-muted-foreground leading-tight">
                            /{paper.paperMarks}
                          </div>
                        </TableHead>
                      ))}
                      <TableHead className="min-w-[44px] w-[44px] text-center px-1 py-1 h-7 sm:min-w-[60px] sm:w-[60px] sm:px-2 sm:h-8">%</TableHead>
                      <TableHead className="min-w-[48px] w-[48px] text-center px-1 py-1 h-7 sm:min-w-[56px] sm:w-[56px] sm:px-2 sm:h-8">Grade</TableHead>
                      <TableHead className="min-w-[172px] w-[172px] px-1 py-1 h-7 sm:min-w-[260px] sm:w-[260px] sm:px-2 sm:h-8">Comment</TableHead>
                      <TableHead className="min-w-[64px] w-[64px] px-1 py-1 h-7 sm:min-w-[78px] sm:w-[78px] sm:px-2 sm:h-8">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayedStudents.map((student) => {
                      const studentMark = studentMarks[student.id];
                      const isNotPresent = studentMark?.attStatus !== "present";
                      const calcResult = studentMark?.attStatus === "present" 
                        ? calculatePercentageAndGrade(studentMark?.paperMarks || {})
                        : { percentage: null, gradeName: "", gradeId: null };
                      const { percentage, gradeName } = calcResult;
                      const livePoolComment = getPoolComment(calcResult.gradeId);
                      const displayComment = studentMark?.commentSource === "custom" 
                        ? studentMark?.customCommentText 
                        : livePoolComment;
                      
                      return (
                        <TableRow key={student.id} className={isNotPresent ? "opacity-60" : ""}>
                          <TableCell className="sticky left-0 z-20 bg-background border-r px-1.5 py-0.5 font-medium align-middle sm:px-2 sm:py-1">
                            <div className="flex flex-col leading-tight">
                              <span className="text-xs sm:text-sm">{student.firstName} {student.lastName}</span>
                              <span className="text-[10px] sm:text-xs text-muted-foreground">{student.admissionNo}</span>
                            </div>
                          </TableCell>
                          <TableCell className="px-1 py-0.5 align-middle sm:px-2 sm:py-1">
                            <Select
                              value={studentMark?.attStatus || "none"}
                              onValueChange={(value) => handleAttStatusChange(student.id, value)}
                            >
                              <SelectTrigger className="h-7 w-[52px] truncate px-1 pr-5 text-xs sm:h-8 sm:w-[82px] sm:px-2 [&>span]:truncate" data-testid={`select-status-${student.id}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">---</SelectItem>
                                <SelectItem value="present">Present</SelectItem>
                                <SelectItem value="absent">Absent</SelectItem>
                                <SelectItem value="sick">Sick</SelectItem>
                                <SelectItem value="excused">Excused</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          {marksData?.papers.map((paper) => (
                            <TableCell key={paper.id} className="px-1 py-0.5 text-center align-middle sm:px-2 sm:py-1">
                              <Input
                                type="number"
                                min={0}
                                step={1}
                                inputMode="numeric"
                                pattern="[0-9]*"
                                max={paper.paperMarks}
                                className="h-7 w-[50px] text-center mx-auto px-1 text-xs sm:h-8 sm:w-20 sm:text-sm"
                                value={studentMark?.paperMarks[paper.id] || ""}
                                onChange={(e) => handlePaperMarkChange(student.id, paper.id, e.target.value)}
                                disabled={isNotPresent && studentMark?.attStatus !== "none"}
                                data-testid={`input-mark-${student.id}-${paper.id}`}
                              />
                            </TableCell>
                          ))}
                          <TableCell className="px-1 py-0.5 text-center font-semibold align-middle sm:px-2 sm:py-1">
                            {percentage !== null ? `${percentage}%` : "-"}
                          </TableCell>
                          <TableCell className="px-1 py-0.5 text-center align-middle sm:px-2 sm:py-1">
                            {gradeName ? (
                              <Badge className={`${getGradeColor(gradeName)} border px-1.5 py-0 text-[10px] sm:text-xs`}>
                                {gradeName}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="px-1 py-0.5 align-middle sm:px-2 sm:py-1">
                            <Textarea
                              rows={1}
                              className="h-7 min-h-7 max-h-7 resize-none overflow-x-hidden overflow-y-hidden whitespace-nowrap px-2 py-1 text-xs leading-5 sm:h-9 sm:min-h-9 sm:max-h-9 sm:whitespace-normal"
                              placeholder={livePoolComment || "No comment available"}
                              value={studentMark?.commentSource === "custom" ? (studentMark?.customCommentText || "") : ""}
                              onChange={(e) => handleCustomCommentChange(student.id, e.target.value)}
                              data-testid={`input-comment-${student.id}`}
                            />
                          </TableCell>
                          <TableCell className="px-1 py-0.5 align-middle sm:px-2 sm:py-1">
                            <Button
                              size="sm"
                              className="h-7 px-1.5 text-xs sm:h-8 sm:px-3"
                              onClick={() => handleManualSave(student.id)}
                              disabled={studentMark?.isSaving || !studentMark?.isDirty}
                              data-testid={`button-save-${student.id}`}
                            >
                              {studentMark?.isSaving ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : studentMark?.isDirty ? (
                                <>
                                  <Save className="h-4 w-4 mr-1" />
                                  Save
                                </>
                              ) : (
                                <>
                                  <CheckCircle2 className="h-4 w-4 mr-1" />
                                  Saved
                                </>
                              )}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!selectedAssessmentId && (
        <Card className="border-dashed">
          <CardContent className="py-8 sm:py-12">
            <div className="text-center text-muted-foreground">
              <AlertCircle className="h-10 w-10 sm:h-12 sm:w-12 mx-auto mb-3 sm:mb-4 opacity-50" />
              <p className="text-base sm:text-lg font-medium">No assessment selected</p>
              <p className="text-sm">Select a class, subject, and assessment above to start entering marks</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
