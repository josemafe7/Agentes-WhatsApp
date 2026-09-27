import type { ReactNode } from "react";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";

type AgendaFieldProps = {
  id: string;
  label: string;
  optional?: boolean;
  help?: string;
  errors?: string[];
  children: ReactNode;
};

/**
 * A field of the agenda dialogs (DESIGN.md «Formularios»): label on top, «(opcional)», the control, help and the
 * server's error. The control must use `id`, `aria-invalid` and `aria-describedby={fieldDescribedBy(…)}`.
 */
export function AgendaField({ id, label, optional, help, errors, children }: AgendaFieldProps) {
  return (
    <Field data-invalid={errors?.length ? true : undefined}>
      <FieldLabel htmlFor={id}>
        {label}
        {optional ? <span className="font-normal text-muted-foreground">(opcional)</span> : null}
      </FieldLabel>
      {children}
      {help ? <FieldDescription id={`${id}-help`}>{help}</FieldDescription> : null}
      <FieldError id={`${id}-error`} errors={errors?.map((message) => ({ message }))} />
    </Field>
  );
}

/** `aria-describedby` for the control of an AgendaField. */
export function fieldDescribedBy(id: string, options: { help?: string; errors?: string[] }): string | undefined {
  const ids = [options.help ? `${id}-help` : null, options.errors?.length ? `${id}-error` : null].filter(Boolean);
  return ids.length ? ids.join(" ") : undefined;
}
