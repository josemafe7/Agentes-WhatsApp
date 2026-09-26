"use client";

import { useActionState, type ComponentProps } from "react";
import { FormMessage } from "@/components/form-message";
import type { Button } from "@/components/ui/button";
import { finishSetupAction } from "../actions";
import { SubmitButton } from "./submit-button";

type FinishButtonProps = {
  /** Where to go after finishing: /bandeja or a channel wizard (the server only accepts known paths). */
  destination: string;
  label: string;
  variant?: ComponentProps<typeof Button>["variant"];
};

/** Step 7 ([ASI-10]): finishes the wizard (saves the date) and then opens `destination`. */
export function FinishButton({ destination, label, variant = "default" }: FinishButtonProps) {
  const [state, formAction, pending] = useActionState(finishSetupAction, undefined);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="destination" value={destination} />
      <SubmitButton variant={variant} pending={pending} pendingLabel="Terminando…">
        {label}
      </SubmitButton>
      <FormMessage result={state} />
    </form>
  );
}
