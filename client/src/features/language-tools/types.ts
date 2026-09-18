export type LanguageCapability =
  | "spelling"
  | "grammar"
  | "punctuation"
  | "style"
  | "offline"
  | "bulk"
  | "generativeRewrite"
  | "requiresNetwork"
  | "supportsBritishEnglish";

export type LanguagePrivacyMode = "local" | "server" | "third-party";
export type LanguageMode = "review_all" | "balanced" | "auto_apply_safe";
export type LanguageIssueCategory =
  | "spelling"
  | "grammar"
  | "punctuation"
  | "style"
  | "context";
export type LanguageIssueAction = "safe" | "review";

export interface LanguageProviderCapabilities {
  spelling: boolean;
  grammar: boolean;
  punctuation: boolean;
  style: boolean;
  offline: boolean;
  bulk: boolean;
  generativeRewrite: boolean;
  requiresNetwork: boolean;
  supportsBritishEnglish: boolean;
  privacyMode: LanguagePrivacyMode;
}

export interface LanguageStudentContext {
  id?: number;
  firstName?: string | null;
  lastName?: string | null;
  gender?: string | null;
}

export interface LanguageIssue {
  id: string;
  source: "provider" | "context";
  providerId?: string;
  category: LanguageIssueCategory;
  action: LanguageIssueAction;
  message: string;
  start: number;
  end: number;
  originalText: string;
  replacements: string[];
  ruleId?: string;
}

export interface LanguageCheckRequest {
  text: string;
  fieldId?: string;
  fieldLabel?: string;
  student?: LanguageStudentContext;
}

export interface LanguageCheckResult {
  originalText: string;
  providerId: string | null;
  providerName: string | null;
  fallbackUsed: boolean;
  issues: LanguageIssue[];
  checkedAt: string;
}

export interface LanguageProvider {
  id: string;
  name: string;
  capabilities: LanguageProviderCapabilities;
  initialize(): Promise<void>;
  isAvailable(): Promise<boolean>;
  check(request: LanguageCheckRequest): Promise<LanguageIssue[]>;
}

export interface LanguageToolsSettings {
  enabled: boolean;
  primaryProvider: string | null;
  fallbackProvider: string | null;
  mode: LanguageMode;
  dialect: "en-GB";
  studentNamePersonalization: boolean;
  genderPronounCheck: boolean;
}

export interface LanguageFieldBinding {
  id: string;
  label: string;
  text: string;
  onChange: (value: string) => void;
  student?: LanguageStudentContext;
  disabled?: boolean;
}
