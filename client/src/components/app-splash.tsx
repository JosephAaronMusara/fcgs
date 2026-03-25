import { ReactNode, useEffect, useMemo, useState } from "react";
import { GraduationCap } from "lucide-react";

type OrgBranding = {
  name: string;
  logo: string | null;
  motto: string | null;
  stamp: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
};

type AppSplashProps = {
  children: ReactNode;
};

const SPLASH_STORAGE_KEY = "fcgs-splash-last-shown-at";
const FIRST_LOAD_DURATION_MS = 3000;
const REPEAT_LOAD_DURATION_MS = 1500;
const RECENT_WINDOW_MS = 1000 * 60 * 60 * 12;
const FADE_OUT_MS = 450;

export default function AppSplash({ children }: AppSplashProps) {
  const [isReady, setIsReady] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [branding, setBranding] = useState<OrgBranding | null>(null);

  const splashDuration = useMemo(() => {
    if (typeof window === "undefined") return FIRST_LOAD_DURATION_MS;

    const lastShownAt = window.localStorage.getItem(SPLASH_STORAGE_KEY);
    const now = Date.now();

    if (!lastShownAt) {
      window.localStorage.setItem(SPLASH_STORAGE_KEY, String(now));
      return FIRST_LOAD_DURATION_MS;
    }

    const elapsed = now - Number(lastShownAt);
    window.localStorage.setItem(SPLASH_STORAGE_KEY, String(now));

    return elapsed < RECENT_WINDOW_MS
      ? REPEAT_LOAD_DURATION_MS
      : FIRST_LOAD_DURATION_MS;
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadBranding = async () => {
      try {
        const response = await fetch("/api/public/org-branding", {
          credentials: "same-origin",
        });

        if (!response.ok) return;

        const data = (await response.json()) as OrgBranding;
        if (isMounted) {
          setBranding(data);
        }
      } catch {
        // Silent fallback to default FCGS display
      }
    };

    loadBranding();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const fadeTimer = window.setTimeout(() => {
      setIsFadingOut(true);
    }, Math.max(0, splashDuration - FADE_OUT_MS));

    const readyTimer = window.setTimeout(() => {
      setIsReady(true);
    }, splashDuration);

    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(readyTimer);
    };
  }, [splashDuration]);

  if (isReady) {
    return <>{children}</>;
  }

  return (
    <div
      className={`fixed inset-0 z-[9999] flex items-center justify-center bg-white transition-opacity duration-500 ${
        isFadingOut ? "opacity-0" : "opacity-100"
      }`}
      data-testid="app-splash-screen"
    >
      <div className="flex flex-col items-center justify-center px-6 text-center">
        <div
          className={`flex flex-col items-center transition-all duration-700 ${
            isFadingOut ? "translate-y-1 opacity-0" : "translate-y-0 opacity-100"
          }`}
        >
          {branding?.logo ? (
            <img
              src={branding.logo}
              alt={branding?.name || "FCGS"}
              className="mb-5 h-32 w-32 object-contain sm:h-36 sm:w-36"
              data-testid="img-app-splash-logo"
            />
          ) : (
            <div className="mb-5 flex h-24 w-24 items-center justify-center rounded-full bg-primary">
              <GraduationCap className="h-12 w-12 text-primary-foreground" />
            </div>
          )}

          <h1
            className="text-xl font-bold tracking-tight sm:text-2xl"
            style={{ color: "#1b2a5c" }}
            data-testid="text-app-splash-title"
          >
            {branding?.name || "FCGS"}
          </h1>

          <p
            className="mt-2 max-w-md text-sm italic sm:text-base"
            style={{ color: "#a31e2e" }}
            data-testid="text-app-splash-motto"
          >
            {branding?.motto || "First Choice Group of Schools"}
          </p>

          <div className="mt-6 flex items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#1b2a5c]/20 border-t-[#1b2a5c]" />
          </div>
        </div>
      </div>
    </div>
  );
}