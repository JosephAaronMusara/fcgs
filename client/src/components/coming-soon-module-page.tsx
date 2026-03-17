import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { LucideIcon } from "lucide-react";

type Props = {
  title: string;
  description: string;
  icon: LucideIcon;
};

export function ComingSoonModulePage({ title, description, icon: Icon }: Props) {
  return (
    <div className="flex min-h-[70vh] items-center justify-center p-6">
      <Card className="w-full max-w-2xl border-dashed">
        <CardContent className="flex flex-col items-center gap-4 p-10 text-center">
          <div className="rounded-full bg-primary/10 p-4">
            <Icon className="h-10 w-10 text-primary" />
          </div>
          <Badge variant="secondary" className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400">
            Coming Soon
          </Badge>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="mx-auto max-w-xl text-sm text-muted-foreground">{description}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
