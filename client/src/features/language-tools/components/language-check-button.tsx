import { useMemo, useRef, useState } from "react";
import { Languages, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { applyLanguageIssue, applySafeLanguageIssues, checkLanguage } from "../language-service";
import { useLanguageToolsSettings } from "../hooks/use-language-settings";
import type { LanguageCheckResult, LanguageFieldBinding, LanguageIssue } from "../types";
import { LanguageReviewDialog } from "./language-review-dialog";

interface Props {
  fields: LanguageFieldBinding[];
  label?: string;
  size?: "default" | "sm" | "lg" | "icon";
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost";
  disabled?: boolean;
  className?: string;
  showProviderStatus?: boolean;
}

type FieldResult = { field: LanguageFieldBinding; result: LanguageCheckResult };

export function LanguageCheckButton({
  fields,
  label = "Check Language",
  size = "sm",
  variant = "outline",
  disabled,
  className,
  showProviderStatus = false,
}: Props) {
  const { settings } = useLanguageToolsSettings();
  const { toast } = useToast();
  const [checking, setChecking] = useState(false);
  const [results, setResults] = useState<FieldResult[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const latestFieldsRef = useRef(fields);
  latestFieldsRef.current = fields;

  const activeFields = useMemo(() => fields.filter((field) => !field.disabled && field.text.trim()), [fields]);
  const allIssues = results.flatMap(({ field, result }) =>
    result.issues.map((issue) => ({ ...issue, fieldId: field.id, fieldLabel: field.label })),
  );
  const safeCount = allIssues.filter((issue) => issue.action === "safe").length;
  const reviewCount = settings.mode === "review_all"
    ? allIssues.length
    : allIssues.filter((issue) => issue.action === "review" || issue.source === "context").length;

  const currentField = (id: string, fallback?: LanguageFieldBinding) =>
    latestFieldsRef.current.find((field) => field.id === id) ?? fallback ?? null;

  const checkStableField = async (initialField: LanguageFieldBinding): Promise<FieldResult | null> => {
    let field = currentField(initialField.id, initialField);
    if (!field || field.disabled || !field.text.trim()) return null;

    // If the user continues typing while the provider is checking, re-run once
    // against the newest text. A provider result is never applied to a different
    // text snapshot because its character offsets would no longer be trustworthy.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const snapshot = { ...field };
      const result = await checkLanguage({
        text: snapshot.text,
        fieldId: snapshot.id,
        fieldLabel: snapshot.label,
        student: snapshot.student,
      }, settings);
      const latest = currentField(snapshot.id, snapshot);
      if (!latest || latest.disabled) return null;
      if (latest.text === snapshot.text) return { field: snapshot, result };
      field = latest;
    }
    return null;
  };

  const runCheck = async () => {
    if (!settings.enabled) {
      toast({ title: "Language Tools disabled", description: "Language checking is disabled in HQ Global Settings." });
      return;
    }
    if (!activeFields.length) {
      toast({ title: "Nothing to check", description: "Enter some text first." });
      return;
    }
    setChecking(true);
    try {
      const next: FieldResult[] = [];
      // Deliberately sequential: providers without native bulk support still get a safe bulk workflow.
      for (const field of activeFields) {
        const checked = await checkStableField(field);
        if (checked) next.push(checked);
      }

      let finalResults = next;
      if (settings.mode === "auto_apply_safe") {
        const refreshed: FieldResult[] = [];
        for (const item of next) {
          const latest = currentField(item.field.id, item.field);
          if (!latest || latest.text !== item.result.originalText) {
            const checked = latest ? await checkStableField(latest) : null;
            if (checked) refreshed.push(checked);
            continue;
          }
          const corrected = applySafeLanguageIssues(latest.text, item.result.issues);
          if (corrected !== latest.text) latest.onChange(corrected);
          const result = await checkLanguage({
            text: corrected,
            fieldId: latest.id,
            fieldLabel: latest.label,
            student: latest.student,
          }, settings);
          refreshed.push({ field: { ...latest, text: corrected }, result });
        }
        finalResults = refreshed;
      }

      setResults(finalResults);
      const issueCount = finalResults.reduce((sum, item) => sum + item.result.issues.length, 0);
      if (!issueCount) toast({ title: "Language check complete", description: "No issues found." });
      if (next.length < activeFields.length) {
        toast({
          title: "Some text changed during checking",
          description: "Those fields were not changed by Language Tools. Run Check Language again once you finish typing.",
        });
      }
    } catch (error: any) {
      toast({
        title: "Language checking unavailable",
        description: error?.message || "The language provider is unavailable. You can continue editing and saving normally.",
        variant: "destructive",
      });
    } finally {
      setChecking(false);
    }
  };

  const applySafe = async () => {
    setChecking(true);
    try {
      const refreshed: FieldResult[] = [];
      for (const item of results) {
        const latest = currentField(item.field.id, item.field);
        if (!latest) continue;
        let checked = item;
        if (latest.text !== item.result.originalText) {
          const fresh = await checkStableField(latest);
          if (!fresh) continue;
          checked = fresh;
        }
        const corrected = applySafeLanguageIssues(checked.result.originalText, checked.result.issues);
        if (corrected !== checked.result.originalText) latest.onChange(corrected);
        const result = await checkLanguage({
          text: corrected,
          fieldId: latest.id,
          fieldLabel: latest.label,
          student: latest.student,
        }, settings);
        refreshed.push({ field: { ...latest, text: corrected }, result });
      }
      setResults(refreshed);
    } catch (error: any) {
      toast({
        title: "Language check needs refreshing",
        description: error?.message || "No unsafe text replacement was made. Run Check Language again.",
        variant: "destructive",
      });
      setResults([]);
    } finally {
      setChecking(false);
    }
  };

  const applyOne = async (issue: LanguageIssue & { fieldId?: string }, replacement: string) => {
    const item = results.find(({ field }) => field.id === issue.fieldId);
    if (!item) return;
    const latest = currentField(item.field.id, item.field);
    if (!latest) return;

    if (latest.text !== item.result.originalText) {
      try {
        const fresh = await checkStableField(latest);
        setResults((current) => current.map((entry) => entry.field.id === latest.id
          ? (fresh ?? entry)
          : entry));
        toast({
          title: "Text changed since the check",
          description: "Suggestions were refreshed so an older character range cannot overwrite your newer typing. Review the updated suggestion.",
        });
      } catch {
        setResults((current) => current.filter((entry) => entry.field.id !== latest.id));
      }
      return;
    }

    const corrected = applyLanguageIssue(item.result.originalText, issue, replacement);
    latest.onChange(corrected);
    try {
      const result = await checkLanguage({
        text: corrected,
        fieldId: latest.id,
        fieldLabel: latest.label,
        student: latest.student,
      }, settings);
      setResults((current) => current.map((entry) => entry.field.id === latest.id
        ? { field: { ...latest, text: corrected }, result }
        : entry));
    } catch {
      setResults((current) => current.filter((entry) => entry.field.id !== latest.id));
    }
  };

  const providerResult = results.find((item) => item.result.providerName)?.result ?? results[0]?.result;
  const providerStatus = providerResult
    ? `${providerResult.providerName || "FCGS context only"}${providerResult.fallbackUsed ? " (fallback)" : ""} · ${safeCount} safe · ${reviewCount} review`
    : null;

  return (
    <div className={`inline-flex flex-wrap items-center gap-1.5 ${className ?? ""}`}>
      <Button
        type="button"
        size={size}
        variant={variant}
        disabled={disabled || checking || !settings.enabled}
        onClick={runCheck}
      >
        {checking ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Languages className="mr-1.5 h-4 w-4" />}
        {checking ? "Checking..." : label}
      </Button>
      {settings.mode === "balanced" && safeCount > 0 ? (
        <Button type="button" size={size} variant="secondary" onClick={applySafe} disabled={checking}>
          Apply All Safe Corrections ({safeCount})
        </Button>
      ) : null}
      {reviewCount > 0 ? (
        <Button type="button" size={size} variant="outline" onClick={() => setReviewOpen(true)} disabled={checking}>
          Review {reviewCount} Suggestion{reviewCount === 1 ? "" : "s"}
        </Button>
      ) : null}
      {showProviderStatus && providerStatus ? (
        <span className="basis-full text-xs text-muted-foreground" aria-live="polite">Provider used: {providerStatus}</span>
      ) : null}
      <LanguageReviewDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        issues={allIssues}
        onApply={applyOne}
        includeSafe={settings.mode === "review_all"}
      />
    </div>
  );
}
