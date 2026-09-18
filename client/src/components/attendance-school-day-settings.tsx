import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { schoolFetch, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Save, Copy } from "lucide-react";

type Schedule = {
  dayOfWeek: number; isSchoolDay: boolean;
  studentStartTime: string; studentLateGraceMinutes: number; studentEndTime: string; studentDismissalGraceMinutes: number;
  staffStartTime: string; staffLateGraceMinutes: number; staffEndTime: string;
  breakStartTime?: string | null; breakEndTime?: string | null; lunchStartTime?: string | null; lunchEndTime?: string | null;
  reconciliationTime: string;
};

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function AttendanceSchoolDaySettings() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{schedules: Schedule[]}>({ queryKey: ["/api/access-control/school-day"] });
  const [schedules, setSchedules] = useState<Schedule[]>([]);

  useEffect(() => { if (data?.schedules) setSchedules(data.schedules.map(x => ({...x}))); }, [data]);

  const saveSchedule = useMutation({
    mutationFn: async () => {
      const r = await schoolFetch("/api/access-control/school-day", {
        method:"PUT",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ schedules }),
      });
      if(!r.ok) throw new Error((await r.json()).message || "Could not save school-day settings");
      return r.json();
    },
    onSuccess: (r) => {
      setSchedules(r.schedules);
      queryClient.invalidateQueries({queryKey:["/api/access-control/school-day"]});
      toast({title:"Attendance & School Day settings saved"});
    },
    onError: (e: Error) => toast({title:"Could not save settings",description:e.message,variant:"destructive"}),
  });

  const update = (day: number, field: keyof Schedule, value: any) => setSchedules(rows => rows.map(r => r.dayOfWeek === day ? {...r,[field]:value} : r));
  const copyDay = (sourceDay: number) => {
    const source = schedules.find(r => r.dayOfWeek === sourceDay); if(!source) return;
    setSchedules(rows => rows.map(r => r.dayOfWeek === sourceDay ? r : {...source, dayOfWeek:r.dayOfWeek}));
    toast({title:`${DAYS[sourceDay]} copied to all other days`});
  };

  if (isLoading) return <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading school-day settings…</CardContent></Card>;

  return <div className="space-y-6">
    <Card>
      <CardHeader>
        <CardTitle>Attendance & School Day</CardTitle>
        <CardDescription>
          Configure the normal weekly attendance pattern and operating times for this school. Date-specific holidays and closures are managed from Calendar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {schedules.map(row => <Card key={row.dayOfWeek} className="border-muted">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">{DAYS[row.dayOfWeek]}</CardTitle>
                <CardDescription>{row.isSchoolDay ? "Regular attendance expected" : "No regular attendance expected"}</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => copyDay(row.dayOfWeek)} title="Copy this day's times to all other days"><Copy className="h-4 w-4" /></Button>
                <Switch checked={row.isSchoolDay} onCheckedChange={v=>update(row.dayOfWeek,"isSchoolDay",v)} />
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <TimeField label="Student start" value={row.studentStartTime} onChange={v=>update(row.dayOfWeek,"studentStartTime",v)} disabled={!row.isSchoolDay}/>
            <NumberField label="Student late grace (min)" value={row.studentLateGraceMinutes} onChange={v=>update(row.dayOfWeek,"studentLateGraceMinutes",v)} disabled={!row.isSchoolDay}/>
            <TimeField label="Student end" value={row.studentEndTime} onChange={v=>update(row.dayOfWeek,"studentEndTime",v)} disabled={!row.isSchoolDay}/>
            <NumberField label="Dismissal grace (min)" value={row.studentDismissalGraceMinutes} onChange={v=>update(row.dayOfWeek,"studentDismissalGraceMinutes",v)} disabled={!row.isSchoolDay}/>
            <TimeField label="Staff expected start" value={row.staffStartTime} onChange={v=>update(row.dayOfWeek,"staffStartTime",v)} disabled={!row.isSchoolDay}/>
            <NumberField label="Staff late grace (min)" value={row.staffLateGraceMinutes} onChange={v=>update(row.dayOfWeek,"staffLateGraceMinutes",v)} disabled={!row.isSchoolDay}/>
            <TimeField label="Staff expected end" value={row.staffEndTime} onChange={v=>update(row.dayOfWeek,"staffEndTime",v)} disabled={!row.isSchoolDay}/>
            <TimeField label="Reconcile & notify" value={row.reconciliationTime} onChange={v=>update(row.dayOfWeek,"reconciliationTime",v)} disabled={!row.isSchoolDay}/>
            <TimeField label="Break start" value={row.breakStartTime || ""} onChange={v=>update(row.dayOfWeek,"breakStartTime",v||null)} disabled={!row.isSchoolDay}/>
            <TimeField label="Break end" value={row.breakEndTime || ""} onChange={v=>update(row.dayOfWeek,"breakEndTime",v||null)} disabled={!row.isSchoolDay}/>
            <TimeField label="Lunch start" value={row.lunchStartTime || ""} onChange={v=>update(row.dayOfWeek,"lunchStartTime",v||null)} disabled={!row.isSchoolDay}/>
            <TimeField label="Lunch end" value={row.lunchEndTime || ""} onChange={v=>update(row.dayOfWeek,"lunchEndTime",v||null)} disabled={!row.isSchoolDay}/>
          </CardContent>
        </Card>)}
        <div className="flex justify-end"><Button onClick={()=>saveSchedule.mutate()} disabled={saveSchedule.isPending}><Save className="mr-2 h-4 w-4" />Save School-Day Settings</Button></div>
      </CardContent>
    </Card>
  </div>;
}

function TimeField({label,value,onChange,disabled}:{label:string;value:string;onChange:(v:string)=>void;disabled?:boolean}) { return <div className="space-y-1"><Label className="text-xs">{label}</Label><Input type="time" value={value} onChange={e=>onChange(e.target.value)} disabled={disabled}/></div>; }
function NumberField({label,value,onChange,disabled}:{label:string;value:number;onChange:(v:number)=>void;disabled?:boolean}) { return <div className="space-y-1"><Label className="text-xs">{label}</Label><Input type="number" min={0} max={240} value={value} onChange={e=>onChange(Number(e.target.value)||0)} disabled={disabled}/></div>; }
