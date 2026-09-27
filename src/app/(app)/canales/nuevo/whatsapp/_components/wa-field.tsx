"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState, type ChangeEvent, type ReactNode } from "react";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import type { FieldHelp } from "../_lib/help";
import { WhereToFind } from "./where-to-find";

type WaFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** «¿Dónde lo encuentro?», right of the label ([WA-01]). */
  help?: FieldHelp;
  description?: ReactNode;
  errors?: string[];
  /** Password input with «Mostrar» (tokens, App Secret, PIN): DESIGN.md › Formularios › Secretos. */
  secret?: boolean;
  inputMode?: "text" | "numeric";
  maxLength?: number;
  placeholder?: string;
  mono?: boolean;
  disabled?: boolean;
};

/** One field of the WhatsApp wizard: label with «¿Dónde lo encuentro?», input, help below and the server's errors. */
export function WaField({ id, label, value, onChange, help, description, errors, secret = false, inputMode = "text", maxLength, placeholder, mono = true, disabled }: WaFieldProps) {
  const [visible, setVisible] = useState(false);
  const invalid = errors && errors.length > 0 ? true : undefined;
  const describedBy = [description ? `${id}-help` : null, invalid ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  const common = {
    id,
    value,
    onChange: (event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value),
    "aria-invalid": invalid,
    "aria-describedby": describedBy,
    autoComplete: "off",
    spellCheck: false,
    inputMode,
    maxLength,
    placeholder,
    disabled,
    className: mono ? "font-mono" : undefined,
  } as const;

  return (
    <Field data-invalid={invalid}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {help ? <WhereToFind help={help} /> : null}
      </div>
      {secret ? (
        <InputGroup>
          <InputGroupInput {...common} type={visible ? "text" : "password"} />
          <InputGroupAddon align="inline-end">
            <InputGroupButton size="icon-xs" aria-label={visible ? "Ocultar" : "Mostrar"} aria-pressed={visible} onClick={() => setVisible((current) => !current)}>
              {visible ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      ) : (
        <Input {...common} type="text" />
      )}
      {description ? <FieldDescription id={`${id}-help`}>{description}</FieldDescription> : null}
      <FieldError id={`${id}-error`} errors={errors?.map((message) => ({ message }))} />
    </Field>
  );
}
