import type { ComponentProps } from "react";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type ContactTextFieldProps = Omit<ComponentProps<typeof Input>, "id"> & {
  id: string;
  label: string;
  optional?: boolean;
  help?: string;
  errors?: string[];
};

/** A text field of the contact forms: label, «(opcional)», help and the server's error next to it (DESIGN.md «Formularios»). */
export function ContactTextField({ id, label, optional, help, errors, ...input }: ContactTextFieldProps) {
  const describedBy = errors ? `${id}-error` : help ? `${id}-help` : undefined;
  return (
    <Field data-invalid={errors ? true : undefined}>
      <FieldLabel htmlFor={id}>
        {label}
        {optional ? <span className="font-normal text-muted-foreground">(opcional)</span> : null}
      </FieldLabel>
      <Input id={id} aria-invalid={errors ? true : undefined} aria-describedby={describedBy} {...input} />
      {help ? <FieldDescription id={`${id}-help`}>{help}</FieldDescription> : null}
      <FieldError id={`${id}-error`} errors={errors?.map((message) => ({ message }))} />
    </Field>
  );
}
