"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/form-message";
import type { ActionResult } from "@/lib/action-result";
import type { SetupFormState } from "../actions";
import { StepFooter } from "./step-footer";
import { SubmitButton } from "./submit-button";

type ContinueFormProps = {
  /** skipStepAction bound to this step by the server component. */
  action: (previous: SetupFormState, formData: FormData) => Promise<ActionResult>;
  backHref: string;
  label?: string;
};

/** Footer of a step with nothing to fill in (the placeholders of steps 5 and 6): «Atrás» and «Continuar». */
export function ContinueForm({ action, backHref, label = "Continuar" }: ContinueFormProps) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="space-y-4">
      <FormMessage result={state} />
      <StepFooter backHref={backHref}>
        <SubmitButton pending={pending} pendingLabel="Un momento…">
          {label}
        </SubmitButton>
      </StepFooter>
    </form>
  );
}
