import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Megaphone, Calendar, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import DOMPurify from "dompurify";

interface Newsletter {
  id: number;
  title: string;
  content: string;
  targetAudience: string;
  targetScope?: string | null;
  isPublished: boolean;
  createdAt: string;
}

export default function MyNewslettersPage() {
  const { data: newsletters, isLoading } = useQuery<Newsletter[]>({
    queryKey: ["/api/me/newsletters"],
  });

  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (isLoading) {
    return (
      <div className="p-3 sm:p-4 lg:p-6 space-y-6">
        <Skeleton className="h-10 w-48" />
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-32 w-full" />)}
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-4 lg:p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold" data-testid="text-newsletters-title">Newsletters</h1>
        <p className="text-muted-foreground">School newsletters and announcements</p>
      </div>

      {newsletters && newsletters.length > 0 ? (
        <div className="space-y-4">
          {newsletters.map(newsletter => {
            const isExpanded = expandedId === newsletter.id;
            return (
              <Card
                key={newsletter.id}
                className="cursor-pointer hover-elevate"
                onClick={() => setExpandedId(isExpanded ? null : newsletter.id)}
                data-testid={`card-newsletter-${newsletter.id}`}
              >
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <Megaphone className="w-5 h-5 text-primary shrink-0" />
                    <div className="min-w-0">
                      <CardTitle className="text-lg">{newsletter.title}</CardTitle>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <Badge variant="outline" className="text-xs capitalize">{newsletter.targetAudience === "all" ? "Everyone" : `${newsletter.targetAudience} only`}</Badge>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {new Date(newsletter.createdAt).toLocaleDateString("en-US", {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                      </div>
                    </div>
                  </div>
                  {isExpanded ? (
                    <ChevronUp className="w-5 h-5 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-muted-foreground shrink-0" />
                  )}
                </CardHeader>
                {isExpanded && (
                  <CardContent>
                    <div
                      className="prose prose-sm dark:prose-invert max-w-none"
                      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(newsletter.content) }}
                    />
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <Megaphone className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">No newsletters published yet.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
