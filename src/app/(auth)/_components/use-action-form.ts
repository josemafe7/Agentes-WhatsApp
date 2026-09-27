"use client";
// react-hook-form with the same Zod schema as the Server Action ([SEG-05] runs again on the server): validates
// on blur and on submit, sends the parsed values to the action and shows its field errors. What was typed is
// never cleared on error (DESIGN.md «Formularios»).
import { zodResolver } from "@hookform/resolvers/zod";
import { unstable_rethrow } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm, type DefaultValues, type FieldValues, type Path } from "react-hook-form";
import type { z } from "zod";
import { fail, type ActionResult } from "@/lib/action-result";

/**
 * When the request never reaches the app (a browser extension or an old service worker answering instead of the
 * server, or the connection dropping), the action throws instead of returning a result: the form explains it and
 * keeps what was typed, instead of taking the whole page to the error screen.
 */
export const CONNECTION_ERROR_MESSAGE =
  "No se ha podido conectar con el servidor. Recarga la página y vuelve a intentarlo. Si sigue pasando, prueba en una ventana privada: alguna extensión del navegador puede estar bloqueando la petición.";

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
      let response: ActionResult<Result>;
      try {
        response = await options.action(values);
      } catch (error) {
        // Next's own signals (a redirect after signing in) must keep going.
        unstable_rethrow(error);
        response = fail(CONNECTION_ERROR_MESSAGE);
      }
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
