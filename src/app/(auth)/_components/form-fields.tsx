"use client";
// Fields of the sign-in and Mi cuenta forms (DESIGN.md «Formularios»): label on top, field, help and then the
// error with its icon, linked with aria-invalid and aria-describedby.
import { CircleAlert, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useState, type ComponentProps, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";

type FieldShellProps = {
  id: string;
  label: string;
  error?: string;
  description?: ReactNode;
  /** Small link or action at the right of the label («¿Has olvidado tu contraseña?»). */
  labelAction?: ReactNode;
  children: ReactNode;
};

export function describedBy(id: string, error?: string, description?: ReactNode): string | undefined {
  const ids = [description ? `${id}-description` : null, error ? `${id}-error` : null].filter(Boolean);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

/** Label, control, help and error of one field. */
export function FieldShell({ id, label, error, description, labelAction, children }: FieldShellProps) {
  return (
    <Field data-invalid={error ? true : undefined}>
      <div className="flex items-center justify-between gap-2">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {labelAction}
      </div>
      {children}
      {description ? <FieldDescription id={`${id}-description`}>{description}</FieldDescription> : null}
      <FieldErrorLine id={`${id}-error`} message={error} />
    </Field>
  );
}

export function FieldErrorLine({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="flex items-center gap-1.5 text-sm text-destructive-text">
      <CircleAlert aria-hidden className="size-4 shrink-0" />
      {message}
    </p>
  );
}

type TextFieldProps = Omit<FieldShellProps, "children"> & Omit<ComponentProps<typeof Input>, "id">;

export function TextField({ id, label, error, description, labelAction, ...inputProps }: TextFieldProps) {
  return (
    <FieldShell id={id} label={label} error={error} description={description} labelAction={labelAction}>
      <Input id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, error, description)} {...inputProps} />
    </FieldShell>
  );
}

/** Password input with «Mostrar» / «Ocultar». */
export function PasswordField({ id, label, error, description, labelAction, ...inputProps }: TextFieldProps) {
  const [visible, setVisible] = useState(false);
  return (
    <FieldShell id={id} label={label} error={error} description={description} labelAction={labelAction}>
      <InputGroup>
        <InputGroupInput
          {...inputProps}
          id={id}
          type={visible ? "text" : "password"}
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, error, description)}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-xs"
            aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
            aria-pressed={visible}
            onClick={() => setVisible((current) => !current)}
          >
            {visible ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </FieldShell>
  );
}

type SubmitButtonProps = { pending: boolean; label: string; pendingLabel: string } & Omit<ComponentProps<typeof Button>, "type" | "children">;

/** Main button of a form: disabled with a spinner and «…ando» text while the action runs. */
export function SubmitButton({ pending, label, pendingLabel, disabled, ...buttonProps }: SubmitButtonProps) {
  return (
    <Button type="submit" disabled={pending || disabled} aria-busy={pending || undefined} {...buttonProps}>
      {pending ? <LoaderCircle aria-hidden className="animate-spin" /> : null}
      {pending ? pendingLabel : label}
    </Button>
  );
}
