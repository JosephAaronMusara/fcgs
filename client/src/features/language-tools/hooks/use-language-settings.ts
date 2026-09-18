import { useQuery } from "@tanstack/react-query";
import { DEFAULT_LANGUAGE_TOOLS_SETTINGS } from "../language-service";
import type { LanguageToolsSettings } from "../types";

export function useLanguageToolsSettings() {
  const query = useQuery<LanguageToolsSettings>({
    queryKey: ["/api/language-tools/settings"],
    staleTime: 60_000,
    retry: false,
  });
  return {
    ...query,
    settings: query.data ?? DEFAULT_LANGUAGE_TOOLS_SETTINGS,
  };
}
