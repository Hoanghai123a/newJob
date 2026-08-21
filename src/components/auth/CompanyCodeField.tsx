import { useEffect, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type ValidCompany = { id: string; code: string; name: string };
const STORAGE_KEY = "jobconnect:last-company-code";

export function useCompanyCodeLookup(code: string, enabled: boolean) {
  const [company, setCompany] = useState<ValidCompany | null>(null);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!enabled || !code) {
      setCompany(null);
      setChecking(false);
      setMessage("");
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setChecking(true);
      try {
        const response = await fetch(`/api/public/company-code?code=${encodeURIComponent(code)}`, {
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.message || "Mã công ty không hợp lệ.");
        setCompany(payload);
        setMessage("");
        window.localStorage.setItem(STORAGE_KEY, code);
      } catch (error) {
        if (controller.signal.aborted) return;
        setCompany(null);
        setMessage(error instanceof Error ? error.message : "Không thể kiểm tra mã công ty.");
      } finally {
        if (!controller.signal.aborted) setChecking(false);
      }
    }, 350);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [code, enabled]);

  return { company, checking, message };
}

export function getRememberedCompanyCode() {
  return typeof window === "undefined" ? "" : window.localStorage.getItem(STORAGE_KEY) || "";
}

export function CompanyCodeField({
  code,
  disabled,
  checking,
  company,
  message,
  onChange,
}: {
  code: string;
  disabled?: boolean;
  checking: boolean;
  company: ValidCompany | null;
  message: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="company-code">Mã công ty</Label>
      <div className="relative">
        <Input
          id="company-code"
          value={code}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          autoComplete="organization"
          placeholder="Nhập đúng mã công ty"
          className={cn(
            "pr-10",
            company && "border-emerald-500 focus-visible:ring-emerald-500",
            message && "border-destructive",
          )}
        />
        {checking ? (
          <Loader2
            className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
            aria-label="Đang kiểm tra mã công ty"
          />
        ) : null}
        {company ? (
          <CheckCircle2
            className="absolute right-3 top-1/2 size-5 -translate-y-1/2 text-emerald-600"
            aria-label="Mã công ty hợp lệ"
          />
        ) : null}
      </div>
      {company ? (
        <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-700">
          <CheckCircle2 className="size-4" aria-hidden="true" />
          {company.name}
        </p>
      ) : null}
      {message ? <p className="text-xs text-destructive">{message}</p> : null}
    </div>
  );
}
