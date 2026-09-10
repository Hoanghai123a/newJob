import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Banknote, Check, ClipboardCopy, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  formatMoneyDigits,
  MAX_MONEY_TO_TEXT_DIGITS,
  moneyToVietnameseText,
  normalizeMoneyDigits,
} from "@/lib/money";

export const Route = createFileRoute("/_authenticated/staff/money-to-text")({
  component: MoneyToTextPage,
});

async function copyText(value: string) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Trình duyệt không hỗ trợ sao chép.");
}

function MoneyToTextPage() {
  const [digits, setDigits] = useState("");
  const [copied, setCopied] = useState(false);
  const overLimit = digits.length > MAX_MONEY_TO_TEXT_DIGITS;
  const result = useMemo(() => {
    if (!digits || overLimit) return "";
    return moneyToVietnameseText(digits);
  }, [digits, overLimit]);

  const handleChange = (value: string) => {
    setDigits(normalizeMoneyDigits(value));
    setCopied(false);
  };

  const handleCopy = async () => {
    if (!result) return;
    try {
      await copyText(result);
      setCopied(true);
      toast.success("Đã sao chép số tiền bằng chữ.");
    } catch {
      toast.error("Không thể sao chép. Vui lòng thử lại.");
    }
  };

  return (
    <PageContainer
      title="Đọc số tiền"
      subtitle="Chuyển số tiền VND thành chữ tiếng Việt"
      desktopWidth="wide"
    >
      <div className="mx-auto grid w-full max-w-5xl gap-4 desktop:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Card className="overflow-hidden rounded-3xl border-primary/15 shadow-soft">
          <div className="gradient-primary flex items-center gap-3 px-5 py-5 text-primary-foreground">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15">
              <Banknote className="h-6 w-6" />
            </div>
            <div>
              <div className="font-semibold">Nhập số tiền</div>
              <div className="text-xs text-primary-foreground/75">Tối đa 18 chữ số</div>
            </div>
          </div>
          <div className="space-y-3 p-5">
            <label htmlFor="money-value" className="text-sm font-medium">
              Số tiền (VND)
            </label>
            <div className="relative">
              <Input
                id="money-value"
                value={formatMoneyDigits(digits)}
                onChange={(event) => handleChange(event.target.value)}
                inputMode="numeric"
                autoComplete="off"
                placeholder="Ví dụ: 1.234.567"
                aria-invalid={overLimit}
                className="h-14 rounded-2xl pr-16 text-lg font-semibold tracking-wide"
              />
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground">
                VND
              </span>
            </div>
            {overLimit ? (
              <p className="text-sm text-destructive">
                Số tiền không vượt quá {MAX_MONEY_TO_TEXT_DIGITS} chữ số.
              </p>
            ) : (
              <p className="text-xs leading-5 text-muted-foreground">
                Có thể nhập hoặc dán số có dấu chấm, dấu phẩy, khoảng trắng hay ký hiệu tiền tệ.
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              className="w-full rounded-2xl"
              disabled={!digits}
              onClick={() => handleChange("")}
            >
              <RotateCcw className="h-4 w-4" />
              Xóa và nhập lại
            </Button>
          </div>
        </Card>

        <Card className="flex min-h-72 flex-col rounded-3xl border-border/70 p-5 shadow-soft">
          <div className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Kết quả bằng chữ
          </div>
          <div className="mt-4 flex flex-1 items-center rounded-2xl border border-primary/15 bg-primary/5 p-5">
            {result ? (
              <p className="text-lg font-semibold leading-8 text-foreground desktop:text-xl">
                {result}
              </p>
            ) : (
              <p className="text-sm leading-6 text-muted-foreground">
                {overLimit && "Hãy rút gọn số tiền về giới hạn cho phép"}
              </p>
            )}
          </div>
          <Button
            type="button"
            className="mt-4 w-full rounded-2xl"
            disabled={!result}
            onClick={handleCopy}
          >
            {copied ? <Check className="h-4 w-4" /> : <ClipboardCopy className="h-4 w-4" />}
            {copied ? "Đã sao chép" : "Sao chép"}
          </Button>
        </Card>
      </div>
    </PageContainer>
  );
}
