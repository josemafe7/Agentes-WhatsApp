"use client";

import { LoaderCircle } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import type { ActionFailure } from "@/lib/action-result";
import { addKnowledgeFaqAction, updateKnowledgeFaqAction } from "../[id]/actions";
import { TextAreaField, TextField } from "./form-fields";

type FaqFormProps = {
  kbId: string;
  /** Editing an existing FAQ; without it, a new one. */
  faq?: { id: string; question: string; answer: string };
  onDone?: () => void;
  onCancel?: () => void;
  /** Prefix of the field ids, unique on the page. */
  idPrefix: string;
};

/** A frequently asked question and its answer ([CON-04]): new, or edited in place. Saving processes it again. */
export function FaqForm({ kbId, faq, onDone, onCancel, idPrefix }: FaqFormProps) {
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const errors = failure?.fieldErrors;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const input = { question: String(data.get("question") ?? ""), answer: String(data.get("answer") ?? "") };
    startTransition(async () => {
      const result = faq ? await updateKnowledgeFaqAction(faq.id, input) : await addKnowledgeFaqAction(kbId, input);
      if (!result.ok) {
        setFailure(result);
        return;
      }
      setFailure(null);
      toast.success(result.message ?? "Pregunta guardada.");
      if (!faq) form.reset();
      onDone?.();
    });
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <FieldGroup>
        <TextField
          id={`${idPrefix}-question`}
          name="question"
          label="Pregunta"
          defaultValue={faq?.question}
          autoComplete="off"
          maxLength={500}
          placeholder="¿Aceptáis pago con tarjeta?"
          errors={errors?.question}
        />
        <TextAreaField
          id={`${idPrefix}-answer`}
          name="answer"
          label="Respuesta"
          defaultValue={faq?.answer}
          rows={4}
          maxLength={10000}
          placeholder="Sí, aceptamos tarjeta, efectivo y Bizum."
          errors={errors?.answer}
          help="Escríbela como se la dirías a un cliente: el agente la usará tal cual."
        />
      </FieldGroup>
      <FormMessage result={failure ?? undefined} />
      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
            Cancelar
          </Button>
        ) : null}
        <Button type="submit" disabled={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          {pending ? "Guardando…" : faq ? "Guardar pregunta" : "Añadir pregunta"}
        </Button>
      </div>
    </form>
  );
}
