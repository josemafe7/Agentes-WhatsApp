"use client";

import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { FREE_TEXT_MAX, INSTRUCTION_MAX } from "@/lib/agent-input";
import type { InstructionValues } from "../_lib/instructions";
import { INSTRUCTION_FIELDS, type InstructionFieldKey } from "../_lib/labels";

type InstructionFieldsProps = {
  values: InstructionValues;
  onChange: (key: InstructionFieldKey, value: string) => void;
  /** Messages of «instructions.<field>». */
  errorsFor?: (path: string) => string[] | undefined;
  idPrefix?: string;
};

/** Guided instructions ([AGE-04]): role, business information, what it can and cannot do, style and hand-off. */
export function InstructionFields({ values, onChange, errorsFor, idPrefix = "instructions" }: InstructionFieldsProps) {
  return (
    <FieldGroup>
      {INSTRUCTION_FIELDS.map((field) => {
        const id = `${idPrefix}-${field.key}`;
        const errors = errorsFor?.(`instructions.${field.key}`);
        const max = field.key === "freeText" ? FREE_TEXT_MAX : INSTRUCTION_MAX;
        return (
          <Field key={field.key} data-invalid={errors ? true : undefined}>
            <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
            <Textarea
              id={id}
              rows={field.key === "freeText" ? 4 : 3}
              value={values[field.key]}
              maxLength={max}
              onChange={(event) => onChange(field.key, event.target.value)}
              aria-invalid={errors ? true : undefined}
              aria-describedby={`${id}-help`}
              className="min-h-20"
            />
            <FieldDescription id={`${id}-help`}>{field.help}</FieldDescription>
            <FieldError errors={errors?.map((message) => ({ message }))} />
          </Field>
        );
      })}
    </FieldGroup>
  );
}
