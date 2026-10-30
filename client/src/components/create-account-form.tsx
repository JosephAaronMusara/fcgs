import { useState, useEffect, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, schoolFetch } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, Check, X, Loader2 } from "lucide-react";

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

interface CreateAccountFormProps {
  entityType: "staff" | "students" | "parents";
  entityId: number;
  entityName: string;
  defaultUsername?: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export function CreateAccountForm({
  entityType,
  entityId,
  entityName,
  defaultUsername = "",
  onSuccess,
  onCancel,
}: CreateAccountFormProps) {
  const { toast } = useToast();
  const [username, setUsername] = useState(defaultUsername);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [sendResetToken, setSendResetToken] = useState(true);
  const [usernameConflict, setUsernameConflict] = useState(false);
  const [checkingUsername, setCheckingUsername] = useState(false);

  const debouncedCheckUsername = useCallback(
    (() => {
      let timer: ReturnType<typeof setTimeout>;
      return (value: string) => {
        clearTimeout(timer);
        if (!value || value.length < 3) {
          setUsernameConflict(false);
          setCheckingUsername(false);
          return;
        }
        setCheckingUsername(true);
        timer = setTimeout(async () => {
          try {
            const res = await schoolFetch(`/api/users/validate-unique?username=${encodeURIComponent(value)}`);
            if (res.ok) {
              const data = await res.json();
              setUsernameConflict(data.username === true);
            }
          } catch {}
          setCheckingUsername(false);
        }, 500);
      };
    })(),
    []
  );

  useEffect(() => {
    debouncedCheckUsername(username);
  }, [username, debouncedCheckUsername]);

  const allPasswordRulesMet = passwordRules.every((r) => r.test(password));
  const canSubmit =
    username.length >= 3 &&
    !usernameConflict &&
    !checkingUsername &&
    (sendResetToken || (password.length > 0 && allPasswordRulesMet));

  const createMutation = useMutation({
    mutationFn: async () => {
      const body: any = { username, sendResetToken };
      if (!sendResetToken) {
        body.password = password;
      }
      const res = await apiRequest("POST", `/api/${entityType}/${entityId}/user`, body);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to create account");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/${entityType}`, entityId, "user"] });
      toast({
        title: "Account Created",
        description: sendResetToken
          ? `A one-time password setup link has been sent to ${entityName} via available channels.`
          : `Account created with a temporary password (valid for 3 logins). Credentials sent to ${entityName}.`,
      });
      onSuccess();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Username (phone, email, or custom)</Label>
        <div className="relative">
          <Input
            placeholder="Enter phone, email, or username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            data-testid="input-username"
          />
          {checkingUsername && (
            <div className="absolute right-2 top-1/2 -translate-y-1/2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
        {usernameConflict && (
          <p className="text-sm text-destructive" data-testid="text-username-conflict">
            This username is already taken
          </p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="sendResetToken"
          checked={sendResetToken}
          onCheckedChange={(checked) => setSendResetToken(checked === true)}
          data-testid="checkbox-send-reset-token"
        />
        <Label htmlFor="sendResetToken" className="cursor-pointer text-sm">
          Send Password Setup Link
        </Label>
      </div>

      {sendResetToken && (
        <p className="text-sm text-muted-foreground pl-6">
          A one-time password setup link (valid for 1 hour) will be sent via all available channels. The user will set their own password.
        </p>
      )}

      <div className="space-y-2">
        <Label className={sendResetToken ? "text-muted-foreground" : ""}>
          Password {!sendResetToken && <span className="text-destructive">*</span>}
        </Label>
        <div className="relative">
          <Input
            type={showPassword ? "text" : "password"}
            placeholder={sendResetToken ? "Not required" : "Enter password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={sendResetToken}
            data-testid="input-password"
          />
          {!sendResetToken && (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setShowPassword(!showPassword)}
              data-testid="button-toggle-password"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          )}
        </div>

        {!sendResetToken && password.length > 0 && (
          <div className="space-y-1 pt-1">
            {passwordRules.map((rule, i) => {
              const met = rule.test(password);
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

        {!sendResetToken && (
          <p className="text-xs text-muted-foreground">
            This password is temporary and valid for 3 logins. The user will then be required to set their own password.
          </p>
        )}
      </div>

      <div className="flex gap-2 pt-2">
        <Button
          onClick={() => createMutation.mutate()}
          disabled={!canSubmit || createMutation.isPending}
          data-testid="button-create-account"
        >
          {createMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Creating...
            </>
          ) : (
            "Create Account"
          )}
        </Button>
        <Button variant="outline" onClick={onCancel} data-testid="button-cancel-create">
          Cancel
        </Button>
      </div>
    </div>
  );
}
