"use client";

import { Bot, TriangleAlert } from "lucide-react";
import { useActionState } from "react";
import { FormMessage } from "@/components/form-message";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action-result";
import type { SetupFormState } from "../actions";
import { FieldErrors, fieldErrorsOf } from "../_components/field-errors";
import { StepFooter } from "../_components/step-footer";
import { SubmitButton } from "../_components/submit-button";
import { createSetupWebchatAction } from "./webchat-actions";

type WebchatStepFormProps = {
  defaultName: string;
  /** The agent of step 5, which will answer in this chat; null when that step was skipped. */
  agentName: string | null;
  skipAction: (previous: SetupFormState, formData: FormData) => Promise<ActionResult>;
  backHref: string;
};

/** Step 6 before the chat exists ([ASI-09]): its name, who will answer, «Crear el chat web» or «Saltar este paso». */
export function WebchatStepForm({ defaultName, agentName, skipAction, backHref }: WebchatStepFormProps) {
  const [state, formAction, pending] = useActionState(createSetupWebchatAction, undefined);
  const [skipState, skipFormAction, skipping] = useActionState(skipAction, undefined);
  const nameErrors = fieldErrorsOf(state, "name");

  return (
    <form action={formAction} className="space-y-6">
      <Field data-invalid={nameErrors.length > 0 ? true : undefined} className="max-w-[640px]">
        <FieldLabel htmlFor="webchat-name">Nombre del chat</FieldLabel>
        <Input
          id="webchat-name"
          name="name"
          defaultValue={defaultName}
          maxLength={80}
          required
          aria-invalid={nameErrors.length > 0 ? true : undefined}
          aria-describedby={nameErrors.length > 0 ? "webchat-name-help webchat-name-error" : "webchat-name-help"}
        />
        <FieldDescription id="webchat-name-help">Para tu equipo: lo verás en Canales y en la bandeja.</FieldDescription>
        <FieldErrors id="webchat-name-error" messages={nameErrors} />
      </Field>
      {agentName ? (
        <p className="flex max-w-[640px] items-start gap-2 text-sm">
          <Bot aria-hidden className="mt-0.5 size-4 shrink-0 text-ai" />
          <span>
            Responderá <strong className="font-medium">{agentName}</strong>, el agente del paso anterior, con la IA encendida. Podrás cambiarlo después
            desde Canales.
          </span>
        </p>
      ) : (
        <p className="flex max-w-[640px] items-start gap-2 text-sm text-warning">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          No creaste ningún agente en el paso anterior: el chat se creará sin agente y la IA no contestará hasta que elijas uno en Canales.
        </p>
      )}
      <p className="max-w-[640px] text-sm text-muted-foreground">
        Al principio solo funciona dentro de la app, en una página de prueba. Cuando quieras ponerlo en tu web, añade tu dominio y copia el código desde
        Canales.
      </p>
      <FormMessage result={state} />
      <FormMessage result={skipState} />
      <StepFooter backHref={backHref}>
        <SubmitButton variant="outline" formAction={skipFormAction} pending={skipping} pendingLabel="Un momento…" formNoValidate>
          Saltar este paso
        </SubmitButton>
        <SubmitButton pending={pending} pendingLabel="Creando…">
          Crear el chat web
        </SubmitButton>
      </StepFooter>
    </form>
  );
}
