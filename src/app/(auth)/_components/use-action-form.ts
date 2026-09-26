"use client";
// react-hook-form with the same Zod schema as the Server Action ([SEG-05] runs again on the server): validates
// on blur and on submit, sends the parsed values to the action and shows its field errors. What was typed is
// never cleared on error (DESIGN.md «Formularios»).
import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition } from "react";
import { useForm, type DefaultValues, type FieldValues, type Path } from "react-hook-form";
import type { z } from "zod";
import type { ActionResult } from "@/lib/action-result";

export function useActionForm<Input extends FieldValues, Output, Result>(options: {
  schema: z.ZodType<Output, Input>;
  action: (values: Output) => Promise<ActionResult<Result>>;
  defaultValues: DefaultValues<Input>;
  onSuccess?: (result: Extract<ActionResult<Result>, { ok: true }>) => void;
}) {
  const form = useForm<Input, unknown, Output>({
    resolver: zodResolver(options.schema),
    mode: "onTouched",
    defaultValues: options.defaultValues,
  });
  const [result, setResult] = useState<ActionResult<Result>>();
  const [pending, startTransition] = useTransition();

  const onSubmit = form.handleSubmit((values) => {
    setResult(undefined);
    startTransition(async () => {
      const response = await options.action(values);
      setResult(response);
      if (response.ok) {
        options.onSuccess?.(response);
        return;
      }
      for (const [field, messages] of Object.entries(response.fieldErrors ?? {})) {
        const [message] = messages;
        if (message) form.setError(field as Path<Input>, { type: "server", message });
      }
    });
  });

  return { form, onSubmit, result, pending };
}
