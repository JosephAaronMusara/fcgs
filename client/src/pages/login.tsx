import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  GraduationCap,
  Mail,
  MapPin,
  Phone,
  Share2,
  Smartphone,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ApplicationFormModal } from "@/pages/apply";

type LoginRole = "staff" | "student" | "parent" | "org_member";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const roleTabs: { id: LoginRole; label: string }[] = [
  { id: "staff", label: "School Staff" },
  { id: "student", label: "Student" },
  { id: "parent", label: "Parent" },
  { id: "org_member", label: "Org HQ" },
];

const IOS_HELP_STEPS = [
  'Tap the Share button in Safari.',
  'Scroll down and tap "Add to Home Screen".',
  'Tap "Add" to install FCGS Portal.',
];

const ANDROID_HELP_STEPS = [
  'If no install prompt appears, open the browser menu.',
  'Tap "Install app" or "Add to Home screen".',
  'Confirm to install FCGS Portal.',
];

const DESKTOP_HELP_STEPS = [
  'Open the browser menu or address-bar install icon.',
  'Choose "Install App".',
  'Confirm the installation prompt.',
];

function isStandaloneMode() {
  if (typeof window === "undefined") return false;

  const mediaStandalone = window.matchMedia?.("(display-mode: standalone)")?.matches;
  const iosStandalone =
    typeof navigator !== "undefined" && "standalone" in navigator
      ? Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
      : false;

  return Boolean(mediaStandalone || iosStandalone);
}

function getDeviceContext() {
  if (typeof window === "undefined") {
    return {
      isIos: false,
      isAndroid: false,
      isSafari: false,
      isStandalone: false,
    };
  }

  const ua = window.navigator.userAgent.toLowerCase();
  const isIos = /iphone|ipad|ipod/.test(ua);
  const isAndroid = /android/.test(ua);
  const isSafari = /safari/.test(ua) && !/chrome|crios|android/.test(ua);

  return {
    isIos,
    isAndroid,
    isSafari,
    isStandalone: isStandaloneMode(),
  };
}

export default function Login() {
  const [, setLocation] = useLocation();
  const { login } = useAuth();
  const { toast } = useToast();
  const [selectedRole, setSelectedRole] = useState<LoginRole>("staff");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showApplicationForm, setShowApplicationForm] = useState(false);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstallSupported, setIsInstallSupported] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  const { data: orgBranding } = useQuery<{
    name: string;
    logo: string | null;
    motto: string | null;
    stamp: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
  }>({
    queryKey: ["/api/public/org-branding"],
  });

  useEffect(() => {
    const refreshInstalledState = () => {
      const standalone = isStandaloneMode();
      const installedFlag =
        typeof window !== "undefined" &&
        window.localStorage.getItem("fcgs-pwa-installed") === "true";
      setIsInstalled(standalone || installedFlag);
    };

    refreshInstalledState();

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      setIsInstallSupported(true);
    };

    const handleAppInstalled = () => {
      window.localStorage.setItem("fcgs-pwa-installed", "true");
      setDeferredPrompt(null);
      setIsInstallSupported(false);
      setIsInstalled(true);
      toast({
        title: "App installed",
        description: "FCGS Portal is now ready from your home screen or desktop.",
      });
    };

    const handleDisplayModeChange = () => {
      const standalone = isStandaloneMode();
      if (standalone) {
        window.localStorage.setItem("fcgs-pwa-installed", "true");
      }
      refreshInstalledState();
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);
    window.matchMedia?.("(display-mode: standalone)")?.addEventListener?.("change", handleDisplayModeChange);
    window.addEventListener("focus", refreshInstalledState);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
      window.matchMedia?.("(display-mode: standalone)")?.removeEventListener?.("change", handleDisplayModeChange);
      window.removeEventListener("focus", refreshInstalledState);
    };
  }, [toast]);

  const device = useMemo(() => getDeviceContext(), [isInstalled, isInstallSupported]);

  const installHelp = useMemo(() => {
    if (device.isIos && device.isSafari) {
      return {
        title: "Install on iPhone or iPad",
        description:
          "Safari does not show the install prompt directly from the button, so use the steps below.",
        steps: IOS_HELP_STEPS,
        icon: <Share2 className="h-4 w-4" />,
      };
    }

    if (device.isAndroid) {
      return {
        title: "Install on Android",
        description:
          "Use the browser install option if the prompt does not appear automatically.",
        steps: ANDROID_HELP_STEPS,
        icon: <Download className="h-4 w-4" />,
      };
    }

    return {
      title: "Install on this device",
      description: "Use your browser's install option to add FCGS Portal as an app.",
      steps: DESKTOP_HELP_STEPS,
      icon: <Smartphone className="h-4 w-4" />,
    };
  }, [device.isAndroid, device.isIos, device.isSafari]);

  const installButtonLabel = isInstalled ? "Open in App" : "Install App";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await login(username, password, selectedRole);
      toast({ title: "Welcome back!", description: "Successfully logged in." });
      setLocation("/");
    } catch (error: any) {
      toast({
        title: "Login failed",
        description: error.message || "Invalid username or password",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleInstallClick = async () => {
    if (isInstalled) {
      window.localStorage.setItem("fcgs-pwa-installed", "true");
      window.location.assign("/?source=open-in-app");
      return;
    }

    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        const choiceResult = await deferredPrompt.userChoice;

        if (choiceResult.outcome === "accepted") {
          window.localStorage.setItem("fcgs-pwa-installed", "true");
          setIsInstalled(true);
        }
      } catch {
        setShowInstallHelp(true);
      } finally {
        setDeferredPrompt(null);
        setIsInstallSupported(false);
      }
      return;
    }

    setShowInstallHelp(true);
  };

  return (
    <>
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/10 via-background to-primary/5 p-4">
        <div className="w-full max-w-lg relative">
          <div className="absolute right-4 top-4 z-10">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-4 rounded-full border-primary/20 bg-background/95 px-1.5 text-[9px] text-primary shadow-sm backdrop-blur hover:bg-primary hover:text-primary-foreground"
              onClick={handleInstallClick}
              data-testid="button-install-app"
            >
              {isInstalled ? (
                <ExternalLink className="mr-0.5 h-2.5 w-2.5" />
              ) : (
                <Download className="mr-0.5 h-2.5 w-2.5" />
              )}
              {installButtonLabel}
            </Button>
          </div>

          <Card className="w-full shadow-lg">
            <CardHeader className="text-center space-y-4 pt-8 sm:pt-6">
              {orgBranding?.logo ? (
                <img
                  src={orgBranding.logo}
                  alt="FCGS Logo"
                  className="mx-auto w-32 h-32 object-contain rounded-lg"
                  data-testid="img-org-logo"
                />
              ) : (
                <div className="mx-auto w-16 h-16 bg-primary rounded-full flex items-center justify-center">
                  <GraduationCap className="w-8 h-8 text-primary-foreground" />
                </div>
              )}
              <div>
                <CardTitle className="text-[1.65rem] leading-tight font-bold whitespace-nowrap" data-testid="text-portal-title">
                  <span style={{ color: "#1b2a5c" }}>{orgBranding?.name || "FCGS"}</span>
                  <span className="block h-4"></span>
                </CardTitle>
                <CardDescription className="font-medium italic" style={{ color: "#a31e2e" }} data-testid="text-portal-subtitle">
                  {orgBranding?.motto || orgBranding?.name || "First Choice Group of Schools"}
                </CardDescription>
              </div>
            </CardHeader>

            <CardContent className="space-y-6">
              <div className="flex justify-center gap-1 p-1 bg-muted rounded-lg flex-wrap">
                {roleTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setSelectedRole(tab.id)}
                    className={cn(
                      "px-3 py-2 text-sm font-medium rounded-md transition-all",
                      selectedRole === tab.id
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                    )}
                    data-testid={`tab-${tab.id}`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="username">Username</Label>
                  <div className="relative">
                    <Input
                      id="username"
                      data-testid="input-username"
                      type="text"
                      placeholder="Enter your phone or email"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="pr-10"
                      required
                    />
                    <User className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      data-testid="input-password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                    <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => setShowPassword(!showPassword)}
                        data-testid="button-toggle-password"
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <Button
                    type="button"
                    variant="ghost"
                    className="px-0 text-primary hover:bg-transparent hover:underline"
                    onClick={() => setLocation("/reset-password")}
                    data-testid="button-reset-password"
                  >
                    Reset Password
                  </Button>
                  <Button
                    type="submit"
                    className="bg-emerald-500 hover:bg-emerald-600"
                    disabled={isLoading}
                    data-testid="button-login"
                  >
                    {isLoading ? "Logging in..." : "Login"}
                  </Button>
                </div>
              </form>

              <div className="border-t pt-4 mt-2">
                <Button
                  type="button"
                  variant="default"
                  className="w-full text-white"
                  style={{ backgroundColor: "#1b2a5c" }}
                  onClick={() => setShowApplicationForm(true)}
                  data-testid="button-apply-admission"
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Apply for Admission
                </Button>
              </div>

              {(orgBranding?.address || orgBranding?.phone || orgBranding?.email) && (
                <div className="border-t pt-4 mt-2">
                  <div className="space-y-1.5 text-sm text-center" style={{ color: "#a31e2e" }}>
                    {orgBranding.address && (
                      <div className="flex items-start justify-center gap-2" data-testid="text-hq-address">
                        <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        <span>{orgBranding.address}</span>
                      </div>
                    )}
                    {(orgBranding.phone || orgBranding.email) && (
                      <div className="flex items-center justify-center gap-4 flex-wrap" data-testid="text-hq-contact-row">
                        {orgBranding.phone && (
                          <div className="flex items-center gap-2" data-testid="text-hq-phone">
                            <Phone className="h-3.5 w-3.5 shrink-0" />
                            <span>{orgBranding.phone}</span>
                          </div>
                        )}
                        {orgBranding.email && (
                          <div className="flex items-center gap-2" data-testid="text-hq-email">
                            <Mail className="h-3.5 w-3.5 shrink-0" />
                            <span>{orgBranding.email}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <ApplicationFormModal
          open={showApplicationForm}
          onOpenChange={setShowApplicationForm}
        />
      </div>

      <Dialog open={showInstallHelp} onOpenChange={setShowInstallHelp}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {installHelp.icon}
              {installHelp.title}
            </DialogTitle>
            <DialogDescription>
              {installHelp.description}
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border bg-muted/30 p-4">
            <ol className="space-y-3 text-sm text-foreground list-decimal pl-5">
              {installHelp.steps.map((step, index) => (
                <li key={`${step}-${index}`}>{step}</li>
              ))}
            </ol>
          </div>

          <DialogFooter>
            <Button type="button" onClick={() => setShowInstallHelp(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}