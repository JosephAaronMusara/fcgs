import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Calendar, Plus, Clock, Trash2 } from "lucide-react";
import type { TimetableSlot, Class, Subject, Staff } from "@shared/schema";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const TIME_SLOTS = [
  "07:30", "08:15", "09:00", "09:45", "10:30", "11:15", "12:00", "12:45", "13:30", "14:15", "15:00"
];

export default function TimetablePage() {
  const { toast } = useToast();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [selectedClass, setSelectedClass] = useState<string>("all");

  const { data: slots = [], isLoading } = useQuery<TimetableSlot[]>({
    queryKey: ["/api/timetable"],
  });

  const { data: classes = [] } = useQuery<Class[]>({
    queryKey: ["/api/classes"],
  });

  const { data: subjectsResponse } = useQuery<{ items: Subject[]; total: number }>({
    queryKey: ["/api/subjects?perPage=500"],
  });
  const subjects = subjectsResponse?.items ?? [];

  const { data: teachers = [] } = useQuery<Staff[]>({
    queryKey: ["/api/staff"],
  });

  const createSlot = useMutation({
    mutationFn: async (data: Partial<TimetableSlot>) => {
      return apiRequest("POST", "/api/timetable", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/timetable"] });
      setIsAddOpen(false);
      toast({ title: "Lesson added to timetable" });
    },
    onError: () => {
      toast({ title: "Failed to add lesson", variant: "destructive" });
    },
  });

  const deleteSlot = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/timetable/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/timetable"] });
      toast({ title: "Lesson removed" });
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    createSlot.mutate({
      classId: parseInt(formData.get("classId") as string),
      subjectId: parseInt(formData.get("subjectId") as string),
      teacherId: parseInt(formData.get("teacherId") as string),
      dayOfWeek: formData.get("dayOfWeek") as string,
      startTime: formData.get("startTime") as string,
      endTime: formData.get("endTime") as string,
      room: formData.get("room") as string,
      schoolId: 1,
    });
  };

  const filteredSlots = selectedClass === "all" 
    ? slots 
    : slots.filter(slot => slot.classId.toString() === selectedClass);

  const getSlotForCell = (day: string, time: string) => {
    return filteredSlots.find(slot => 
      slot.dayOfWeek === day && slot.startTime === time
    );
  };

  const getSubjectName = (id: number) => subjects.find(s => s.id === id)?.name || "Unknown";
  const getClassName = (id: number) => classes.find(c => c.id === id)?.className || "Unknown";
  const getTeacherName = (id: number) => {
    const teacher = teachers.find(t => t.id === id);
    return teacher ? `${teacher.firstName} ${teacher.lastName}` : "Unknown";
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Calendar className="h-8 w-8" style={{ color: "#1b2a5c" }} />
          <div>
            <h1 className="text-3xl font-bold tracking-tight" style={{ color: "#1b2a5c" }}>Timetable</h1>
            <p className="text-muted-foreground">Class schedules and lesson planning</p>
          </div>
        </div>
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-slot">
              <Plus className="h-4 w-4 mr-2" />
              Add Lesson
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Lesson to Timetable</DialogTitle>
              <DialogDescription>Schedule a new lesson</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="classId">Class</Label>
                  <Select name="classId" required>
                    <SelectTrigger data-testid="select-class">
                      <SelectValue placeholder="Select class" />
                    </SelectTrigger>
                    <SelectContent>
                      {classes.map((cls) => (
                        <SelectItem key={cls.id} value={cls.id.toString()}>
                          {cls.className}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="subjectId">Subject</Label>
                  <Select name="subjectId" required>
                    <SelectTrigger data-testid="select-subject">
                      <SelectValue placeholder="Select subject" />
                    </SelectTrigger>
                    <SelectContent>
                      {subjects.map((subject) => (
                        <SelectItem key={subject.id} value={subject.id.toString()}>
                          {subject.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="teacherId">Teacher</Label>
                <Select name="teacherId" required>
                  <SelectTrigger data-testid="select-teacher">
                    <SelectValue placeholder="Select teacher" />
                  </SelectTrigger>
                  <SelectContent>
                    {teachers.map((teacher) => (
                      <SelectItem key={teacher.id} value={teacher.id.toString()}>
                        {teacher.firstName} {teacher.lastName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-4 grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="dayOfWeek">Day</Label>
                  <Select name="dayOfWeek" required>
                    <SelectTrigger data-testid="select-day">
                      <SelectValue placeholder="Select day" />
                    </SelectTrigger>
                    <SelectContent>
                      {DAYS.map((day) => (
                        <SelectItem key={day} value={day}>{day}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="room">Room</Label>
                  <Input id="room" name="room" placeholder="e.g., Room A1" data-testid="input-room" />
                </div>
              </div>
              <div className="grid gap-4 grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="startTime">Start Time</Label>
                  <Select name="startTime" required>
                    <SelectTrigger data-testid="select-start-time">
                      <SelectValue placeholder="Start time" />
                    </SelectTrigger>
                    <SelectContent>
                      {TIME_SLOTS.map((time) => (
                        <SelectItem key={time} value={time}>{time}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="endTime">End Time</Label>
                  <Select name="endTime" required>
                    <SelectTrigger data-testid="select-end-time">
                      <SelectValue placeholder="End time" />
                    </SelectTrigger>
                    <SelectContent>
                      {TIME_SLOTS.map((time) => (
                        <SelectItem key={time} value={time}>{time}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={createSlot.isPending} data-testid="button-submit-slot">
                Add to Timetable
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center gap-4">
        <Label>Filter by Class:</Label>
        <Select value={selectedClass} onValueChange={setSelectedClass}>
          <SelectTrigger className="w-[200px]" data-testid="select-filter-class">
            <SelectValue placeholder="All Classes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Classes</SelectItem>
            {classes.map((cls) => (
              <SelectItem key={cls.id} value={cls.id.toString()}>
                {cls.className}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Weekly Schedule
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="border p-2 bg-muted">Time</th>
                  {DAYS.map((day) => (
                    <th key={day} className="border p-2 bg-muted">{day}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {TIME_SLOTS.map((time) => (
                  <tr key={time}>
                    <td className="border p-2 font-medium text-center bg-muted/50">{time}</td>
                    {DAYS.map((day) => {
                      const slot = getSlotForCell(day, time);
                      return (
                        <td key={`${day}-${time}`} className="border p-2 min-w-[150px]">
                          {slot ? (
                            <div className="bg-primary/10 rounded p-2 text-xs space-y-1">
                              <div className="font-semibold">{getSubjectName(slot.subjectId)}</div>
                              <Badge variant="outline" className="text-xs">
                                {getClassName(slot.classId)}
                              </Badge>
                              <div className="text-muted-foreground">{getTeacherName(slot.teacherId)}</div>
                              {slot.room && <div className="text-muted-foreground">{slot.room}</div>}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => deleteSlot.mutate(slot.id)}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : null}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
