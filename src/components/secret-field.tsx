"use client";

import { Eye, EyeOff } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";

type SecretFieldProps = {
  name: string;
  label: string;
  masked?: string | null;
  placeholder?: string;
  help?: ReactNode;
  /** Message of the server next to the field ([AJU-15]), e.g. when the saved value cannot be kept. */
  error?: string;
};

/**
 * Secret input for forms. With a saved value it only shows the mask («••••1234») and «Cambiar», which reveals an
 * empty password input; until then no field named `name` is submitted, so the server keeps the saved value.
 * It never receives the real secret. `help` (text or a <HelpLink>) is shown under the field.
 */
export function SecretField({ name, label, masked, placeholder, help, error }: SecretFieldProps) {
  const [editing, setEditing] = useState(!masked);
  const [visible, setVisible] = useState(false);
  const inputId = useId();
  const helpId = useId();
  const describedBy = help ? helpId : undefined;

  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
      {editing ? (
        <div className="flex items-center gap-2">
          <InputGroup>
            <InputGroupInput
              id={inputId}
              name={name}
              type={visible ? "text" : "password"}
              placeholder={placeholder}
              autoComplete="off"
              spellCheck={false}
              aria-describedby={describedBy}
              className="font-mono"
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                aria-label={visible ? "Ocultar" : "Mostrar"}
                aria-pressed={visible}
                onClick={() => setVisible((current) => !current)}
              >
                {visible ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          {masked ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setEditing(false);
                setVisible(false);
              }}
            >
              Cancelar
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <output id={inputId} className="font-mono text-sm" aria-describedby={describedBy}>
            {masked}
          </output>
          <Button type="button" variant="outline" onClick={() => setEditing(true)}>
            Cambiar
          </Button>
        </div>
      )}
      {help ? <FieldDescription id={helpId}>{help}</FieldDescription> : null}
      <FieldError>{error}</FieldError>
    </Field>
  );
}
