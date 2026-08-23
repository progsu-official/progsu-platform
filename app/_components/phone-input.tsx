"use client";

import { forwardRef } from "react";

import { formatUsPhone, phoneDigits } from "@/lib/phone";
import { cn } from "@/lib/utils";

// A phone field that can only hold a phone number.
//
// Masking as they type rather than validating on submit: the field simply
// cannot reach an invalid state, so nobody types twenty digits and finds out
// at the end. `inputMode="tel"` gets the numeric keypad on a phone, and the
// visible "+1" says the shape we accept before anyone starts typing rather
// than after they get it wrong.
export const PhoneInput = forwardRef<
  HTMLInputElement,
  {
    id?: string;
    value: string;
    onChange: (next: string) => void;
    disabled?: boolean;
    invalid?: boolean;
    describedBy?: string;
    className?: string;
    required?: boolean;
  }
>(function PhoneInput(
  { id, value, onChange, disabled, invalid, describedBy, className, required },
  ref
) {
  return (
    <div
      className={cn(
        "flex h-11 w-full overflow-hidden rounded-[14px] border bg-card transition-colors",
        "focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 focus-within:ring-offset-background",
        invalid ? "border-destructive/60" : "border-border",
        disabled && "opacity-50",
        className
      )}
    >
      <span
        aria-hidden
        className="flex shrink-0 items-center border-r border-border bg-muted/50 px-3 text-sm text-muted-foreground"
      >
        +1
      </span>
      <input
        ref={ref}
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        required={required}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        placeholder="(404) 555-1234"
        // The mask is applied on the way in, so state only ever holds a
        // well-formed value and the 10-digit cap is structural rather than a
        // rule someone can trip.
        value={formatUsPhone(value)}
        onChange={(e) => onChange(formatUsPhone(e.target.value))}
        onPaste={(e) => {
          // Pasted numbers arrive as +1-404-555-1234, 404.555.1234, or with a
          // country code already on the front. Take the digits and let the
          // mask decide the shape.
          e.preventDefault();
          onChange(formatUsPhone(phoneDigits(e.clipboardData.getData("text"))));
        }}
        className="min-w-0 flex-1 bg-transparent px-3.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed"
      />
    </div>
  );
});
