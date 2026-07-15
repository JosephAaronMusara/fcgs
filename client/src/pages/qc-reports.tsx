import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InfiniteYearPicker } from "@/components/ui/infinite-year-picker";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ClipboardList, FileText, Download, Layers, Info, TrendingUp, ChevronDown } from "lucide-react";

interface ClassProgress {
  id: number;
  name: string;
  totalStudents: number;
  completedReports: number;
  progressPct: number;
}

interface StreamData {
  streamId: number;
  streamName: string;
  classes: ClassProgress[];
  totalStudents: number;
  totalCompleted: number;
  progressPct: number;
}

interface LandingData {
  term: number;
  year: string;
  streams: StreamData[];
}

function ProgressCircle({ pct }: { pct: number }) {
  const cls = pct >= 80 ? "qc-pct-circle-ok" : pct >= 40 ? "qc-pct-circle-mid" : "qc-pct-circle-bad";
  return (
    <span className={`qc-pct-circle ${cls}`} data-testid="pill-progress">
      {pct}%
    </span>
  );
}

export default function QCReportsPage() {
  const [, navigate] = useLocation();
  const [selectedTerm, setSelectedTerm] = useState<string>("");
  const [selectedYear, setSelectedYear] = useState<string>("");

  const termParam = selectedTerm ? `term=${selectedTerm}` : "";
  const yearParam = selectedYear ? `year=${selectedYear}` : "";
  const queryParams = [termParam, yearParam].filter(Boolean).join("&");
  const queryUrl = `/api/qc-reports/landing${queryParams ? `?${queryParams}` : ""}`;

  const { data, isLoading } = useQuery<LandingData>({
    queryKey: [queryUrl],
  });


  return (
    <div className="qc-wrap p-4 md:p-6 max-w-7xl mx-auto" data-testid="qc-reports-landing">
      <div className="qc-card">
        <div className="qc-topbar">
          <div className="flex items-center gap-3" data-testid="text-page-title">
            <ClipboardList className="h-8 w-8" style={{ color: "#1b2a5c" }} />
            <div>
              <h1 className="text-3xl font-bold tracking-tight" style={{ color: "#1b2a5c" }}>Quality Control Reports</h1>
              <p className="text-muted-foreground">Monitor teaching progress and curriculum coverage</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Select value={selectedTerm || (data?.term?.toString() || "")} onValueChange={setSelectedTerm}>
              <SelectTrigger className="w-[120px]" data-testid="select-term">
                <SelectValue placeholder="Term" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Term 1</SelectItem>
                <SelectItem value="2">Term 2</SelectItem>
                <SelectItem value="3">Term 3</SelectItem>
              </SelectContent>
            </Select>

            <InfiniteYearPicker
              value={selectedYear || (data?.year || "")}
              onValueChange={setSelectedYear}
              placeholder="Year"
              className="w-[100px]"
              dataTestId="select-year"
            />
          </div>
        </div>

        {isLoading && (
          <div className="space-y-4">
            {[1, 2].map(i => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-24 w-full" />
              </div>
            ))}
          </div>
        )}

        {data && data.streams.length === 0 && (
          <div className="text-center py-8">
            <ClipboardList className="h-12 w-12 mx-auto mb-3" style={{ color: "var(--qc-muted)" }} />
            <p style={{ color: "var(--qc-muted)" }}>No classes found. Set up classes and streams first.</p>
          </div>
        )}

        {data && data.streams.map(stream => {
          const sp = stream.progressPct;
          return (
            <div key={stream.streamId} className="qc-stream" data-testid={`card-stream-${stream.streamId}`}>
              <div className="qc-stream-head">
                <div className="qc-stream-name">
                  <Layers className="h-4 w-4" />
                  Stream: {stream.streamName}
                </div>
              </div>

              <div className="qc-bar-full" style={{ marginBottom: "10px" }}>
                <span style={{ width: `${Math.max(sp, 3)}%` }} />
                <div className="qc-bar-full-label">{sp}%</div>
              </div>

              <table className="qc-table">
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>Class</th>
                    <th style={{ textAlign: "center" }}>Progress</th>
                    <th style={{ textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {stream.classes.map(cls => (
                    <tr key={cls.id} data-testid={`row-class-${cls.id}`}>
                      <td className="qc-class-name">{cls.name}</td>
                      <td style={{ textAlign: "center" }}><ProgressCircle pct={cls.progressPct} /></td>
                      <td>
                        <div className="flex items-center justify-end gap-2 flex-wrap" style={{ padding: "0 4px" }}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                data-testid={`button-options-${cls.id}`}
                              >
                                Options <ChevronDown className="w-3 h-3 ml-1" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="min-w-[200px]">
                              <DropdownMenuItem
                                onClick={() => navigate(`/qc-reports/class/${cls.id}?term=${data.term}&year=${data.year}&view=progress`)}
                                data-testid={`button-progress-${cls.id}`}
                              >
                                <TrendingUp className="w-4 h-4 mr-2" /> Progress
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {}}
                                data-testid={`button-download-${cls.id}`}
                              >
                                <Download className="w-4 h-4 mr-2" /> Download
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                          <Button
                            size="sm"
                            onClick={() => navigate(`/qc-reports/class/${cls.id}?term=${data.term}&year=${data.year}&view=reports`)}
                            style={{ backgroundColor: "#1b2a5c", color: "white" }}
                            data-testid={`button-reports-${cls.id}`}
                          >
                            <FileText className="w-4 h-4 mr-1" />
                            Reports
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}

        <div className="qc-note">
          <Info className="h-3 w-3 shrink-0" />
          "Reports" opens individual student QC reports. "Progress" shows subject-level completion.
        </div>
      </div>
    </div>
  );
}
