import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { GraduationCap, Eye, EyeOff, User, FileText, MapPin, Phone, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import { ApplicationFormModal } from "@/pages/apply";
import type { Organization } from "@shared/schema";

type LoginRole = "staff" | "student" | "parent" | "org_member";

const roleTabs: { id: LoginRole; label: string }[] = [
  { id: "staff", label: "School Staff" },
  { id: "student", label: "Student" },
  { id: "parent", label: "Parent" },
  { id: "org_member", label: "Org HQ" },
];

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
  
  const { data: orgBranding } = useQuery<{ name: string; logo: string | null; motto: string | null; stamp: string | null; address: string | null; phone: string | null; email: string | null }>({
    queryKey: ["/api/public/org-branding"],
  });

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

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/10 via-background to-primary/5 p-4">
      <Card className="w-full max-w-lg shadow-lg">
        <CardHeader className="text-center space-y-4">
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
          <div className="flex justify-center gap-1 p-1 bg-muted rounded-lg">
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
            <div className="flex items-center justify-between">
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

      <ApplicationFormModal
        open={showApplicationForm}
        onOpenChange={setShowApplicationForm}
      />
    </div>
  );
}
