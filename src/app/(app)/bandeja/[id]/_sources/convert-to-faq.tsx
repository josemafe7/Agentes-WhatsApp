"use client";

import { BookPlus, LoaderCircle, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { ErrorState } from "@/components/error-state";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { ActionFailure, ActionResult } from "@/lib/action-result";
import { ACTION_FAILED } from "../../_components/use-inbox-action";
import { convertToFaqAction, loadFaqDraftAction, type FaqDraftView } from "./actions";

/** Same limits as a FAQ written in Conocimiento (src/data/knowledge-documents.ts). */
const MAX_QUESTION = 500;
const MAX_ANSWER = 10_000;
const CHOOSE_BASE = "Elige la base donde guardarla.";

type ConvertToFaqProps = { conversationId: string; messageId: string };

/**
 * «Convertir en FAQ» under a person's reply ([CON-22]): a dialog with the customer's question and the reply as the
 * answer, both editable, saved in the chosen base. Shown only to whoever may do it; the server checks again.
 */
export function ConvertToFaq({ conversationId, messageId }: ConvertToFaqProps) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="link" size="xs" className="h-auto p-0 text-xs text-primary-text">
          <BookPlus aria-hidden />
          Convertir en FAQ
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        {open ? <FaqDialogBody conversationId={conversationId} messageId={messageId} close={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Header() {
  return (
    <DialogHeader>
      <DialogTitle>Convertir en pregunta frecuente</DialogTitle>
      <DialogDescription>Revisa la pregunta y la respuesta y quita los datos personales: la IA las usará para responder a cualquier cliente.</DialogDescription>
    </DialogHeader>
  );
}

/** Reads the draft when the dialog opens; «Reintentar» reads it again. */
function FaqDialogBody({ conversationId, messageId, close }: ConvertToFaqProps & { close: () => void }) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ attempt: number; result: ActionResult<FaqDraftView> } | null>(null);

  useEffect(() => {
    let current = true;
    loadFaqDraftAction({ conversationId, messageId }).then(
      (result) => {
        if (current) setLoaded({ attempt, result });
      },
      () => {
        if (current) setLoaded({ attempt, result: { ok: false, error: ACTION_FAILED } });
      },
    );
    return () => {
      current = false;
    };
  }, [conversationId, messageId, attempt]);

  const result = loaded?.attempt === attempt ? loaded.result : null;
  if (result === null) {
    return (
      <div className="grid gap-4" aria-busy="true">
        <Header />
        <span className="sr-only">Cargando…</span>
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }
  if (!result.ok || !result.data) {
    return (
      <div className="grid gap-4">
        <Header />
        <ErrorState
          description={result.ok ? ACTION_FAILED : result.error}
          retry={
            <Button type="button" variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>
              <RotateCcw aria-hidden />
              Reintentar
            </Button>
          }
        />
      </div>
    );
  }
  return <FaqForm conversationId={conversationId} messageId={messageId} draft={result.data} close={close} />;
}

function FaqForm({ conversationId, messageId, draft, close }: ConvertToFaqProps & { draft: FaqDraftView; close: () => void }) {
  const [kbId, setKbId] = useState(draft.bases.length === 1 ? draft.bases[0].id : "");
  const [question, setQuestion] = useState(draft.question);
  const [answer, setAnswer] = useState(draft.answer);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const ids = useId();
  const errors = failure?.fieldErrors;
  const noBases = draft.bases.length === 0;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!kbId) {
      setFailure({ ok: false, error: "Revisa los campos marcados.", fieldErrors: { kbId: [CHOOSE_BASE] } });
      return;
    }
    startTransition(async () => {
      let result: ActionResult<{ id: string }> | null;
      try {
        result = await convertToFaqAction({ conversationId, messageId, kbId, question, answer });
      } catch {
        result = null;
      }
      if (result?.ok) {
        toast.success(result.message ?? "Pregunta frecuente guardada.");
        close();
        return;
      }
      setFailure(result ?? { ok: false, error: ACTION_FAILED });
    });
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <Header />
      <FieldGroup>
        <Field data-invalid={errors?.kbId ? true : undefined}>
          <FieldLabel htmlFor={noBases ? undefined : `${ids}-base`}>Base de conocimiento</FieldLabel>
          {noBases ? (
            <p className="text-sm text-muted-foreground">
              Todavía no hay bases de conocimiento.{" "}
              <Link href="/conocimiento" className="font-medium text-primary-text hover:underline">
                Crea una en Conocimiento
              </Link>{" "}
              y vuelve para guardar esta respuesta.
            </p>
          ) : (
            <Select value={kbId} onValueChange={setKbId}>
              <SelectTrigger id={`${ids}-base`} className="w-full" aria-invalid={errors?.kbId ? true : undefined}>
                <SelectValue placeholder="Elige una base" />
              </SelectTrigger>
              <SelectContent>
                {draft.bases.map((base) => (
                  <SelectItem key={base.id} value={base.id}>
                    {base.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <FieldError errors={errors?.kbId?.map((message) => ({ message }))} />
        </Field>
        <Field data-invalid={errors?.question ? true : undefined}>
          <FieldLabel htmlFor={`${ids}-question`}>Pregunta</FieldLabel>
          <Textarea
            id={`${ids}-question`}
            rows={2}
            value={question}
            maxLength={MAX_QUESTION}
            onChange={(event) => setQuestion(event.target.value)}
            aria-invalid={errors?.question ? true : undefined}
            aria-describedby={`${ids}-question-help`}
          />
          <FieldDescription id={`${ids}-question-help`}>Sale de lo que escribió el cliente antes de la respuesta.</FieldDescription>
          <FieldError errors={errors?.question?.map((message) => ({ message }))} />
        </Field>
        <Field data-invalid={errors?.answer ? true : undefined}>
          <FieldLabel htmlFor={`${ids}-answer`}>Respuesta</FieldLabel>
          <Textarea
            id={`${ids}-answer`}
            rows={5}
            value={answer}
            maxLength={MAX_ANSWER}
            onChange={(event) => setAnswer(event.target.value)}
            aria-invalid={errors?.answer ? true : undefined}
          />
          <FieldError errors={errors?.answer?.map((message) => ({ message }))} />
        </Field>
      </FieldGroup>
      <FormMessage result={failure ?? undefined} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={close} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending || noBases}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          {pending ? "Guardando…" : "Guardar FAQ"}
        </Button>
      </DialogFooter>
    </form>
  );
}
