"use client";

import { Eye, EyeOff } from "lucide-react";
import { useActionState, useState } from "react";
import { FormMessage } from "@/components/form-message";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/validation";
import { createOwnerAction } from "../actions";
import { FieldErrors, fieldErrorsOf } from "./field-errors";
import { StepFooter } from "./step-footer";
import { SubmitButton } from "./submit-button";

/**
 * Step 1 ([ASI-02]): name, email and password of the owner, and the installation code when the installation is
 * published (`askSetupToken`). Controlled inputs, so nothing typed is lost on errors.
 */
export function OwnerForm({ askSetupToken }: { askSetupToken: boolean }) {
  const [state, formAction, pending] = useActionState(createOwnerAction, undefined);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const errors = {
    name: fieldErrorsOf(state, "name"),
    email: fieldErrorsOf(state, "email"),
    password: fieldErrorsOf(state, "password"),
    setupToken: fieldErrorsOf(state, "setupToken"),
  };

  return (
    <form action={formAction} className="max-w-[640px] space-y-6">
      <FieldGroup>
        <Field data-invalid={errors.name.length > 0 || undefined}>
          <FieldLabel htmlFor="owner-name">Tu nombre</FieldLabel>
          <Input
            id="owner-name"
            name="name"
            autoComplete="name"
            required
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-invalid={errors.name.length > 0 || undefined}
            aria-describedby={errors.name.length > 0 ? "owner-name-error" : undefined}
          />
          <FieldErrors id="owner-name-error" messages={errors.name} />
        </Field>
        <Field data-invalid={errors.email.length > 0 || undefined}>
          <FieldLabel htmlFor="owner-email">Email</FieldLabel>
          <Input
            id="owner-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={errors.email.length > 0 || undefined}
            aria-describedby={errors.email.length > 0 ? "owner-email-error" : undefined}
          />
          <FieldErrors id="owner-email-error" messages={errors.email} />
        </Field>
        <Field data-invalid={errors.password.length > 0 || undefined}>
          <FieldLabel htmlFor="owner-password">Contraseña</FieldLabel>
          <InputGroup>
            <InputGroupInput
              id="owner-password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              maxLength={PASSWORD_MAX_LENGTH}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={errors.password.length > 0 || undefined}
              aria-describedby={errors.password.length > 0 ? "owner-password-help owner-password-error" : "owner-password-help"}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((current) => !current)}
              >
                {showPassword ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <FieldDescription id="owner-password-help">Al menos {PASSWORD_MIN_LENGTH} caracteres.</FieldDescription>
          <FieldErrors id="owner-password-error" messages={errors.password} />
        </Field>
        {askSetupToken ? (
          <Field data-invalid={errors.setupToken.length > 0 || undefined}>
            <FieldLabel htmlFor="owner-setup-token">Código de instalación</FieldLabel>
            <Input
              id="owner-setup-token"
              name="setupToken"
              type="password"
              autoComplete="off"
              spellCheck={false}
              required
              maxLength={500}
              value={setupToken}
              onChange={(event) => setSetupToken(event.target.value)}
              className="font-mono"
              aria-invalid={errors.setupToken.length > 0 || undefined}
              aria-describedby={
                errors.setupToken.length > 0 ? "owner-setup-token-help owner-setup-token-error" : "owner-setup-token-help"
              }
            />
            <FieldDescription id="owner-setup-token-help">
              El valor de SETUP_TOKEN que pusiste al publicar la app. Así nadie más puede quedarse con la instalación.
            </FieldDescription>
            <FieldErrors id="owner-setup-token-error" messages={errors.setupToken} />
          </Field>
        ) : null}
      </FieldGroup>
      <FormMessage result={state} />
      <StepFooter>
        <SubmitButton pending={pending} pendingLabel="Creando la cuenta…">
          Crear cuenta y continuar
        </SubmitButton>
      </StepFooter>
    </form>
  );
}
