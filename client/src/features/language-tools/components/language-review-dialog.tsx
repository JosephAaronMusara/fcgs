import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import type { LanguageIssue } from "../types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  issues: Array<LanguageIssue & { fieldId?: string; fieldLabel?: string }>;
  onApply: (issue: LanguageIssue & { fieldId?: string }, replacement: string) => void;
  includeSafe?: boolean;
}

export function LanguageReviewDialog({ open, onOpenChange, title = "Language suggestions", issues, onApply, includeSafe = false }: Props) {
  const reviewIssues = includeSafe
    ? issues
    : issues.filter((issue) => issue.action === "review" || issue.source === "context");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {includeSafe
              ? "Review every language suggestion before changing the text."
              : "Review contextual or meaning-sensitive suggestions before changing the text."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {reviewIssues.length === 0 ? (
            <p className="text-sm text-muted-foreground">No review-required suggestions were found.</p>
          ) : reviewIssues.map((issue) => (
            <div key={`${issue.fieldId ?? "field"}:${issue.id}`} className="rounded-md border p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                {issue.fieldLabel ? <Badge variant="outline">{issue.fieldLabel}</Badge> : null}
                <Badge variant="secondary">{issue.category}</Badge>
                {issue.source === "context" ? <Badge variant="outline">FCGS context</Badge> : null}
              </div>
              <p className="text-sm">{issue.message}</p>
              {issue.originalText ? (
                <p className="text-xs text-muted-foreground">Current: “{issue.originalText}”</p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {issue.replacements.map((replacement, index) => (
                  <Button
                    key={`${issue.id}:${index}`}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onApply(issue, replacement)}
                  >
                    Apply “{replacement || "remove"}”
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
