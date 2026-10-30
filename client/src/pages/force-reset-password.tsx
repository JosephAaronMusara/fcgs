import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, Check, X, Loader2, ShieldAlert } from "lucide-react";
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

export default function ForceResetPassword() {
  const { toast } = useToast();
  const { user, currentSchoolId } = useAuth();
  const [, setLocation] = useLocation();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const allRulesMet = passwordRules.every((r) => r.test(newPassword));
  const passwordsMatch = newPassword === confirmPassword && confirmPassword.length > 0;

  const resetMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/force-reset-password", { newPassword });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to reset password");
      }
      return res.json();
    },
    onSuccess: async (data) => {
      if (data.user) {
        queryClient.setQueryData(["/api/auth/user"], data.user);
      }
      await queryClient.refetchQueries({ queryKey: ["/api/auth/user"], type: "active" });
      const refreshedUser = queryClient.getQueryData<any>(["/api/auth/user"]) || data.user;
      toast({ title: "Password Updated", description: "Your password has been reset successfully." });
      setLocation(refreshedUser?.role === "org_admin" && currentSchoolId === null ? "/org" : "/dashboard");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
            <ShieldAlert className="h-8 w-8 text-amber-600 dark:text-amber-400" />
          </div>
          <CardTitle className="text-xl">Password Reset Required</CardTitle>
          <p className="text-sm text-muted-foreground mt-2">
            {user?.firstName ? `Hi ${user.firstName}, y` : "Y"}our password needs to be updated before you can continue.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
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
            disabled={!allRulesMet || !passwordsMatch || resetMutation.isPending}
            data-testid="button-reset-password"
          >
            {resetMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Resetting...
              </>
            ) : (
              "Set New Password"
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
