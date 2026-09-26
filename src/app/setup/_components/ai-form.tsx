"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { FormMessage } from "@/components/form-message";
import { HelpLink } from "@/components/help-link";
import { SecretField } from "@/components/secret-field";
import { StatusLight } from "@/components/status-light";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action-result";
import { saveAiAction, testKeyAction, type KeyTestView, type SetupFormState } from "../actions";
import { FieldErrors, fieldErrorsOf } from "./field-errors";
import { StepFooter } from "./step-footer";
import { SubmitButton } from "./submit-button";

const OPENROUTER_KEYS_URL = "https://openrouter.ai/settings/keys";

type AiFormProps = {
  /** Masked view only ([PER-07]): the form never receives the key. */
  keyView: { configured: boolean; masked: string | null; readable: boolean; source: "settings" | "env" | null };
  chatModel: string;
  recommendedModel: string;
  /** «Hacerlo más tarde»: skipStepAction bound to step 4 by the server component. */
  skipAction: (previous: SetupFormState, formData: FormData) => Promise<ActionResult>;
  backHref: string;
};

/** Step 4 ([ASI-07]): OpenRouter key with «Probar clave», default chat model, or «Hacerlo más tarde». */
export function AiForm({ keyView, chatModel, recommendedModel, skipAction, backHref }: AiFormProps) {
  const [state, formAction, pending] = useActionState(saveAiAction, undefined);
  const [skipState, skipFormAction, skipping] = useActionState(skipAction, undefined);
  const [model, setModel] = useState(chatModel);
  const [testResult, setTestResult] = useState<ActionResult<KeyTestView> | null>(null);
  const [testing, startTest] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const modelErrors = fieldErrorsOf(state, "chatModel");
  const keyErrors = fieldErrorsOf(state, "openrouterKey");
  const savedMask = keyView.source === "settings" ? keyView.masked : null;

  const testKey = () => {
    const typed = formRef.current ? new FormData(formRef.current).get("openrouterKey") : null;
    startTest(async () => {
      setTestResult(await testKeyAction(typeof typed === "string" ? typed : ""));
    });
  };

  return (
    <form ref={formRef} action={formAction} className="space-y-6">
      <FieldGroup className="max-w-[640px]">
        <div className="space-y-2">
          <SecretField
            name="openrouterKey"
            label="Clave de OpenRouter"
            masked={savedMask}
            placeholder="sk-or-v1-…"
            help={
              <>
                Créala en OpenRouter, en Settings › Keys, con un límite de gasto.{" "}
                <HelpLink href={OPENROUTER_KEYS_URL} />
              </>
            }
          />
          {keyView.source === "env" ? (
            <p className="text-sm text-muted-foreground">
              Ahora se usa la clave de la variable OPENROUTER_API_KEY (
              <span className="font-mono">{keyView.masked}</span>). Si escribes una aquí, tendrá prioridad.
            </p>
          ) : null}
          {keyView.configured && !keyView.readable ? (
            <p className="text-sm text-destructive-text">
              La clave guardada no se puede leer (ha cambiado la clave de cifrado). Escríbela de nuevo.
            </p>
          ) : null}
          <FieldErrors id="openrouter-key-error" messages={keyErrors} />
          <div className="space-y-2">
            <Button type="button" variant="outline" onClick={testKey} disabled={testing} aria-busy={testing}>
              {testing ? "Probando…" : "Probar clave"}
            </Button>
            <div aria-live="polite">
              {testing ? <StatusLight status="pending" label="Clave de OpenRouter" /> : null}
              {!testing && testResult ? <KeyTestResult result={testResult} /> : null}
            </div>
          </div>
        </div>

        <Field data-invalid={modelErrors.length > 0 || undefined}>
          <FieldLabel htmlFor="chat-model">Modelo de chat</FieldLabel>
          <Input
            id="chat-model"
            name="chatModel"
            required
            maxLength={200}
            spellCheck={false}
            className="font-mono"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            aria-invalid={modelErrors.length > 0 || undefined}
            aria-describedby={modelErrors.length > 0 ? "chat-model-help chat-model-error" : "chat-model-help"}
          />
          <FieldDescription id="chat-model-help">
            Identificador del modelo en OpenRouter. Recomendado: <span className="font-mono">{recommendedModel}</span>.
            Lo puedes cambiar cuando quieras en Ajustes › IA.
          </FieldDescription>
          <FieldErrors id="chat-model-error" messages={modelErrors} />
        </Field>
      </FieldGroup>

      <FormMessage result={state} />
      <FormMessage result={skipState} />
      <StepFooter backHref={backHref}>
        <SubmitButton variant="outline" formAction={skipFormAction} pending={skipping} pendingLabel="Un momento…" formNoValidate>
          Hacerlo más tarde
        </SubmitButton>
        <SubmitButton pending={pending}>Continuar</SubmitButton>
      </StepFooter>
    </form>
  );
}

function KeyTestResult({ result }: { result: ActionResult<KeyTestView> }) {
  if (!result.ok || !result.data) {
    return <StatusLight status="error" label="Clave de OpenRouter" detail={result.ok ? undefined : result.error} />;
  }
  const { valid, message, details, warnings } = result.data;
  if (!valid) return <StatusLight status="error" label="Clave de OpenRouter" detail={message} />;
  return (
    <div className="space-y-1">
      <StatusLight status={warnings.length > 0 ? "warn" : "ok"} label={message} detail={details.join(" · ")} />
      {warnings.map((warning) => (
        <p key={warning} className="pl-6 text-xs text-warning">
          {warning}
        </p>
      ))}
    </div>
  );
}
