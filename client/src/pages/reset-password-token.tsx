import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, Check, X, Loader2, KeyRound } from "lucide-react";
import { useLocation } from "wouter";

interface PasswordRule {
  label: string;
  test: (pw: string) => boolean;
}

const passwordRules: PasswordRule[] = [
  { label: "At least 8 characters", test: (pw) => pw.length >= 8 },
  { label: "A lowercase letter", test: (pw) => /[a-z]/.test(pw) },
  { label: "An uppercase letter", test: (pw) => /[A-Z]/.test(pw) },
  { label: "A numeral", test: (pw) => /\d/.test(pw) },
  { label: "A special character", test: (pw) => /[^a-zA-Z0-9]/.test(pw) },
];

export default function ResetPasswordToken() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const initialToken = useMemo(() => new URLSearchParams(window.location.search).get("token") || "", []);
  const [username, setUsername] = useState("");
  const [token, setToken] = useState(initialToken);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const isLinkFlow = Boolean(token);
  const allRulesMet = passwordRules.every((r) => r.test(newPassword));
  const passwordsMatch = newPassword === confirmPassword && confirmPassword.length > 0;

  const requestMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/request-password-reset", { username });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to request password reset");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Request received",
        description: data.message || "If an account exists, password reset instructions have been sent.",
      });
      setLocation("/login");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/reset-password-with-token", { token, newPassword });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to reset password");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Password Set", description: data.message || "Your password has been set. You can now log in." });
      setLocation("/login");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
            <KeyRound className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-xl">{isLinkFlow ? "Set Your Password" : "Reset Password"}</CardTitle>
          <p className="text-sm text-muted-foreground mt-2">
            {isLinkFlow
              ? "Choose your new password to complete the reset."
              : "Enter your username or email address and we will send a one-time password reset link to the contact details saved on your account."}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isLinkFlow ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="username">Username or Email</Label>
                <Input
                  id="username"
                  placeholder="Enter your username or email"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  data-testid="input-username"
                />
              </div>

              <Button
                className="w-full"
                onClick={() => requestMutation.mutate()}
                disabled={!username.trim() || requestMutation.isPending}
                data-testid="button-request-reset-link"
              >
                {requestMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Sending Reset Link...
                  </>
                ) : (
                  "Send Reset Link"
                )}
              </Button>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Label>New Password</Label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter new password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    data-testid="input-new-password"
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowPassword(!showPassword)}
                    data-testid="button-toggle-password-visibility"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {newPassword.length > 0 && (
                <div className="space-y-1">
                  {passwordRules.map((rule, i) => {
                    const met = rule.test(newPassword);
                    return (
                      <div
                        key={i}
                        className={`flex items-center gap-2 text-xs transition-colors ${met ? "text-green-600 dark:text-green-400" : "text-destructive"}`}
                        data-testid={`password-rule-${i}`}
                      >
                        {met ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                        {rule.label}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="space-y-2">
                <Label>Confirm Password</Label>
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="Confirm new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  data-testid="input-confirm-password"
                />
                {confirmPassword.length > 0 && !passwordsMatch && (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <X className="h-3 w-3" /> Passwords do not match
                  </p>
                )}
                {passwordsMatch && (
                  <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                    <Check className="h-3 w-3" /> Passwords match
                  </p>
                )}
              </div>

              <Button
                className="w-full"
                onClick={() => resetMutation.mutate()}
                disabled={!token || !allRulesMet || !passwordsMatch || resetMutation.isPending}
                data-testid="button-set-password"
              >
                {resetMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Setting Password...
                  </>
                ) : (
                  "Set Password"
                )}
              </Button>
            </>
          )}

          <div className="text-center">
            <Button variant="ghost" className="underline underline-offset-4" onClick={() => setLocation("/login")} data-testid="link-back-to-login">
              Back to Login
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
