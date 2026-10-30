import * as React from "react";
import { CalendarIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function isoToDisplay(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  return match ? `${match[2]}-${match[1].slice(-2)}` : "";
}

function displayToIso(value: string) {
  const match = /^(\d{1,2})[-/](\d{2})$/.exec(value.trim());
  if (!match) return "";
  const month = Number(match[1]);
  if (month < 1 || month > 12) return "";
  return `20${match[2]}-${String(month).padStart(2, "0")}`;
}

function formatMonthInput(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}-${digits.slice(2)}` : digits;
}

export interface MonthInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange" | "min" | "max"
> {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
}

export const MonthInput = React.forwardRef<HTMLInputElement, MonthInputProps>(
  ({ value, onChange, min, max, className, disabled, onBlur, onKeyDown, ...rest }, ref) => {
    const nativeRef = React.useRef<HTMLInputElement>(null);
    const [text, setText] = React.useState(() => isoToDisplay(value));

    React.useEffect(() => {
      setText(isoToDisplay(value));
    }, [value]);

    const inRange = (month: string) => (!min || month >= min) && (!max || month <= max);
    const commit = (raw: string) => {
      const normalized = displayToIso(raw);
      if (normalized && inRange(normalized)) {
        setText(isoToDisplay(normalized));
        if (normalized !== value) onChange(normalized);
      } else if (!raw.trim()) {
        setText("");
        if (value) onChange("");
      } else {
        setText(isoToDisplay(value));
      }
    };

    const selectMonth = (month: string) => {
      if (!month || !inRange(month)) return;
      setText(isoToDisplay(month));
      if (month !== value) onChange(month);
    };

    return (
      <div className="relative w-full min-w-[9rem]">
        <Input
          {...rest}
          ref={ref}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          disabled={disabled}
          placeholder="mm-yy"
          value={text}
          onChange={(event) => setText(formatMonthInput(event.target.value))}
          onBlur={(event) => {
            commit(event.target.value);
            onBlur?.(event);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit(event.currentTarget.value);
            onKeyDown?.(event);
          }}
          className={cn("pr-12", className)}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          className="absolute right-1 top-1/2 h-9 w-9 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          aria-label="Chọn tháng"
          onClick={() => {
            const picker = nativeRef.current;
            if (!picker) return;
            if (typeof picker.showPicker === "function") picker.showPicker();
            else picker.click();
          }}
        >
          <CalendarIcon className="h-4 w-4" />
        </Button>
        <input
          ref={nativeRef}
          type="month"
          tabIndex={-1}
          aria-hidden="true"
          value={value}
          min={min}
          max={max}
          onChange={(event) => selectMonth(event.target.value)}
          className="pointer-events-none absolute right-1 top-1/2 h-9 w-9 -translate-y-1/2 opacity-0"
        />
      </div>
    );
  },
);
MonthInput.displayName = "MonthInput";
