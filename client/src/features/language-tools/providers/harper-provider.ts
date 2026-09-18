import type {
  LanguageCheckRequest,
  LanguageIssue,
  LanguageIssueAction,
  LanguageIssueCategory,
  LanguageProvider,
} from "../types";

let linterPromise: Promise<any> | null = null;

function normalizeCategory(kind: string, message: string): LanguageIssueCategory {
  const value = `${kind} ${message}`.toLowerCase();
  if (/(spell|word choice|dictionary|typo)/.test(value)) return "spelling";
  if (/(punct|comma|period|apostrophe|quote|hyphen|space|capital)/.test(value)) return "punctuation";
  if (/(style|wordy|readab|passive|repetition|cliche)/.test(value)) return "style";
  return "grammar";
}

function classifyAction(
  category: LanguageIssueCategory,
  kind: string,
  replacements: string[],
): LanguageIssueAction {
  if (replacements.length !== 1) return "review";
  if (category === "spelling" || category === "punctuation") return "safe";
  const normalized = kind.toLowerCase();
  if (
    category === "grammar" &&
    /(article|agreement|subject|verb|conjug|number|determiner|possessive|pronoun case|grammar|a_vs_an)/.test(normalized)
  ) {
    return "safe";
  }
  return "review";
}

async function getLinter() {
  if (!linterPromise) {
    linterPromise = (async () => {
      const harper = await import("harper.js");
      // Browser builds must use Harper's inlined WASM module. Importing
      // `harper.js/binary` gives the browser a URL-backed binary; under the
      // portal's Vite/SPAs fallback that request can resolve to index.html,
      // which WebAssembly then rejects as an invalid binary. The inlined
      // module is still lazy-loaded with the provider and keeps Harper fully
      // local/offline without a separate .wasm fetch.
      const { binaryInlined } = await import("harper.js/binaryInlined");
      const linter = new harper.WorkerLinter({
        binary: binaryInlined,
        dialect: harper.Dialect.British,
      });
      await linter.setup();
      // Defensive initialization: retain Harper defaults explicitly so future
      // provider swaps never rely on page-level Harper configuration.
      try {
        const defaults = await linter.getDefaultLintConfig();
        await linter.setLintConfig(defaults);
      } catch {
        // Older/newer Harper builds may initialize defaults internally.
      }
      return linter;
    })().catch((error) => {
      // Do not permanently memoize a failed initialization. A later check can
      // retry after a transient worker/cache/runtime problem is resolved.
      linterPromise = null;
      throw error;
    });
  }
  return linterPromise;
}

export const harperProvider: LanguageProvider = {
  id: "harper",
  name: "Harper",
  capabilities: {
    spelling: true,
    grammar: true,
    punctuation: true,
    style: true,
    offline: true,
    bulk: false,
    generativeRewrite: false,
    requiresNetwork: false,
    supportsBritishEnglish: true,
    privacyMode: "local",
  },
  async initialize() {
    await getLinter();
  },
  async isAvailable() {
    try {
      await getLinter();
      return true;
    } catch {
      return false;
    }
  },
  async check(request: LanguageCheckRequest): Promise<LanguageIssue[]> {
    if (!request.text.trim()) return [];
    const linter = await getLinter();
    const lints = await linter.lint(request.text);
    return lints.map((lint: any, index: number) => {
      const span = lint.span();
      const kind = String(lint.lint_kind?.() ?? lint.lint_kind_pretty?.() ?? "grammar");
      const message = String(lint.message?.() ?? "Language suggestion");
      const replacements = (lint.suggestions?.() ?? []).map((suggestion: any) =>
        String(suggestion.get_replacement_text?.() ?? ""),
      );
      const category = normalizeCategory(kind, message);
      const originalText = Array.from(request.text).slice(span.start, span.end).join("");
      return {
        id: `harper:${span.start}:${span.end}:${index}`,
        source: "provider" as const,
        providerId: "harper",
        category,
        action: classifyAction(category, kind, replacements),
        message,
        start: Number(span.start),
        end: Number(span.end),
        originalText,
        replacements,
        ruleId: kind,
      };
    });
  },
};
