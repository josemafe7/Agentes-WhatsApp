"use client";

import { REGEXP_ONLY_DIGITS } from "input-otp";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { describedBy, FieldShell } from "./form-fields";

const CODE_LENGTH = 6;
const SLOTS = Array.from({ length: CODE_LENGTH }, (_, index) => index);

type TotpCodeFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  /** Called when the 6 digits are in (to send the form without pressing the button). */
  onComplete?: () => void;
  error?: string;
  description?: string;
  disabled?: boolean;
};

/** The 6-digit code of the authenticator app, one box per digit; the browser can autofill it. */
export function TotpCodeField({ id, label, value, onChange, onBlur, onComplete, error, description, disabled }: TotpCodeFieldProps) {
  return (
    <FieldShell id={id} label={label} error={error} description={description}>
      <InputOTP
        id={id}
        maxLength={CODE_LENGTH}
        pattern={REGEXP_ONLY_DIGITS}
        inputMode="numeric"
        autoComplete="one-time-code"
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        onComplete={onComplete}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, description)}
      >
        <InputOTPGroup>
          {SLOTS.map((index) => (
            <InputOTPSlot key={index} index={index} aria-invalid={error ? true : undefined} className="size-10 text-base" />
          ))}
        </InputOTPGroup>
      </InputOTP>
    </FieldShell>
  );
}
