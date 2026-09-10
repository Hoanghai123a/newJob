import * as React from "react";
import { CalendarIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { normalizeDate } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

function isoToDisplay(iso: string): string {
  if (!iso) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return "";
  const [, y, m, d] = match;
  return `${d}/${m}/${y}`;
}

function isoToDate(iso: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return undefined;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function dateToIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function autoFormatText(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export interface DateInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type" | "min" | "max"
> {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  className?: string;
}

export const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(
  (
    { value, onChange, min, max, placeholder = "dd/mm/yyyy", className, disabled, ...rest },
    ref,
  ) => {
    const [text, setText] = React.useState(() => isoToDisplay(value));
    const [open, setOpen] = React.useState(false);

    React.useEffect(() => {
      setText(isoToDisplay(value));
    }, [value]);

    const commit = (raw: string) => {
      const normalized = normalizeDate(raw);
      if (normalized) {
        if (normalized !== value) onChange(normalized);
        setText(isoToDisplay(normalized));
      } else if (!raw.trim()) {
        if (value) onChange("");
        setText("");
      } else {
        setText(isoToDisplay(value));
      }
    };

    const selectedDate = isoToDate(value);
    const minDate = min ? isoToDate(min) : undefined;
    const maxDate = max ? isoToDate(max) : undefined;

    return (
      <div className={cn("relative", className)}>
        <Input
          {...rest}
          ref={ref}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          disabled={disabled}
          placeholder={placeholder}
          value={text}
          onChange={(event) => setText(autoFormatText(event.target.value))}
          onBlur={(event) => {
            commit(event.target.value);
            rest.onBlur?.(event);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit(event.currentTarget.value);
            }
            rest.onKeyDown?.(event);
          }}
          className={cn("pr-10", rest["aria-invalid"] && "border-destructive")}
        />
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={disabled}
              className="absolute right-1 top-1/2 h-9 w-9 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              tabIndex={-1}
              aria-label="Chọn ngày"
            >
              <CalendarIcon className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto p-0">
            <Calendar
              mode="single"
              captionLayout="dropdown"
              selected={selectedDate}
              defaultMonth={selectedDate ?? maxDate ?? new Date()}
              onSelect={(date) => {
                if (!date) return;
                const iso = dateToIso(date);
                onChange(iso);
                setText(isoToDisplay(iso));
                setOpen(false);
              }}
              disabled={(date) => {
                if (minDate && date < minDate) return true;
                if (maxDate && date > maxDate) return true;
                return false;
              }}
            />
          </PopoverContent>
        </Popover>
      </div>
    );
  },
);
DateInput.displayName = "DateInput";
