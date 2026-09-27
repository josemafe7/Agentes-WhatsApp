import type { ComponentProps, ReactNode } from "react";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type FieldFrameProps = { id: string; label: string; optional?: boolean; help?: string; errors?: string[] };

function describedBy({ id, help, errors }: FieldFrameProps): string | undefined {
  return errors ? `${id}-error` : help ? `${id}-help` : undefined;
}

function Frame({ id, label, optional, help, errors, children }: FieldFrameProps & { children: ReactNode }) {
  return (
    <Field data-invalid={errors ? true : undefined}>
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

/** Text field of the knowledge forms: label, «(opcional)», help and the server's error next to it (DESIGN.md «Formularios»). */
export function TextField({ id, label, optional, help, errors, ...input }: Omit<ComponentProps<typeof Input>, "id"> & FieldFrameProps) {
  const frame = { id, label, optional, help, errors };
  return (
    <Frame {...frame}>
      <Input id={id} aria-invalid={errors ? true : undefined} aria-describedby={describedBy(frame)} {...input} />
    </Frame>
  );
}

export function TextAreaField({ id, label, optional, help, errors, ...textarea }: Omit<ComponentProps<typeof Textarea>, "id"> & FieldFrameProps) {
  const frame = { id, label, optional, help, errors };
  return (
    <Frame {...frame}>
      <Textarea id={id} aria-invalid={errors ? true : undefined} aria-describedby={describedBy(frame)} {...textarea} />
    </Frame>
  );
}
