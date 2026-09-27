"use client";

import { CircleAlert, LoaderCircle } from "lucide-react";
import { useId, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { ActionFailure } from "@/lib/action-result";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { estimateTokens } from "@/lib/knowledge-limits";
import { createContextFileAction, updateContextFileAction, type ContextFileView } from "../actions";
import { budgetLevel, type BudgetLimits } from "../_lib/view";

/** What the dialog shows: «Pegar texto», or an existing file being loaded, edited or only read. */
export type ContextFileEditor =
  | { mode: "create" }
  | { mode: "edit" | "view"; fileId: string; status: "loading" }
  | { mode: "edit" | "view"; fileId: string; status: "ready"; file: ContextFileView }
  | { mode: "edit" | "view"; fileId: string; status: "error"; error: string };

type ContextFileDialogProps = {
  agentId: string;
  editor: ContextFileEditor | null;
  onClose: () => void;
  /** Tokens of the agent's context files, all of them (the cap is per agent). */
  totalTokens: number;
  limits: BudgetLimits;
};

/** «Pegar texto», «Editar» and «Ver» of a context file ([CON-01]): editable Markdown with its live token count. */
export function ContextFileDialog({ agentId, editor, onClose, totalTokens, limits }: ContextFileDialogProps) {
  return (
    <Dialog open={editor !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-3xl">{editor ? <DialogBody agentId={agentId} editor={editor} onClose={onClose} totalTokens={totalTokens} limits={limits} /> : null}</DialogContent>
    </Dialog>
  );
}

function DialogBody({ agentId, editor, onClose, totalTokens, limits }: ContextFileDialogProps & { editor: ContextFileEditor }) {
  if (editor.mode === "create") {
    return <ContextFileForm agentId={agentId} initial={{ title: "", contentMd: "" }} otherTokens={totalTokens} limits={limits} onClose={onClose} />;
  }
  if (editor.status === "loading") return <LoadingBody />;
  if (editor.status === "error") {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Archivo de contexto</DialogTitle>
          <DialogDescription className="sr-only">No se ha podido abrir el archivo.</DialogDescription>
        </DialogHeader>
        <p role="alert" className="flex items-center gap-2 text-sm text-destructive-text">
          <CircleAlert aria-hidden className="size-4 shrink-0" />
          {editor.error}
        </p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cerrar
          </Button>
        </DialogFooter>
      </>
    );
  }
  if (editor.mode === "view") return <ContextFileViewer file={editor.file} onClose={onClose} />;
  return (
    <ContextFileForm
      agentId={agentId}
      fileId={editor.fileId}
      initial={{ title: editor.file.title, contentMd: editor.file.contentMd }}
      otherTokens={Math.max(0, totalTokens - editor.file.tokenCount)}
      limits={limits}
      onClose={onClose}
    />
  );
}

function LoadingBody() {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Archivo de contexto</DialogTitle>
        <DialogDescription>Cargando el texto…</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3" aria-hidden>
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    </>
  );
}

/** Read-only (supervisor and viewer): the Markdown exactly as the agent receives it. */
function ContextFileViewer({ file, onClose }: { file: ContextFileView; onClose: () => void }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle className="pr-8 break-words">{file.title}</DialogTitle>
        <DialogDescription>{formatNumber(file.tokenCount)} tokens. El agente lo lee entero antes de cada respuesta.</DialogDescription>
      </DialogHeader>
      <div
        tabIndex={0}
        role="region"
        aria-label={`Texto de ${file.title}`}
        className="max-h-[60vh] overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-sm break-words whitespace-pre-wrap"
      >
        {file.contentMd}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cerrar
        </Button>
      </DialogFooter>
    </>
  );
}

type ContextFileFormProps = {
  agentId: string;
  /** Absent for «Pegar texto». */
  fileId?: string;
  initial: { title: string; contentMd: string };
  /** Tokens of the agent's other context files. */
  otherTokens: number;
  limits: BudgetLimits;
  onClose: () => void;
};

function ContextFileForm({ agentId, fileId, initial, otherTokens, limits, onClose }: ContextFileFormProps) {
  const [title, setTitle] = useState(initial.title);
  const [contentMd, setContentMd] = useState(initial.contentMd);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const titleId = useId();
  const contentId = useId();
  const errors = failure?.fieldErrors;
  const tokens = estimateTokens(contentMd);
  const total = otherTokens + tokens;
  const over = total > limits.maxTokens;
  const level = budgetLevel(total, limits);
  const creating = fileId === undefined;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    startTransition(async () => {
      const result = creating
        ? await createContextFileAction(agentId, { title, contentMd })
        : await updateContextFileAction({ agentId, fileId, title, contentMd });
      if (!result.ok) {
        setFailure(result);
        return;
      }
      toast.success(result.message ?? "Cambios guardados.");
      onClose();
    });
  }

  const titleErrors = errors?.title;
  const contentErrors = errors?.contentMd;
  // Field errors are shown next to their field; the general line only when nothing else says why.
  const general = failure && !titleErrors && !contentErrors ? failure : undefined;

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{creating ? "Pegar texto" : "Editar archivo de contexto"}</DialogTitle>
        <DialogDescription>
          Texto en Markdown que el agente lee entero antes de cada respuesta. Usa títulos (#, ##) y listas (-) para ordenarlo.
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field data-invalid={titleErrors ? true : undefined}>
          <FieldLabel htmlFor={titleId}>Título</FieldLabel>
          <Input
            id={titleId}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={200}
            autoComplete="off"
            placeholder="Normas del salón"
            aria-invalid={titleErrors ? true : undefined}
            aria-describedby={titleErrors ? `${titleId}-error` : undefined}
          />
          <FieldError id={`${titleId}-error`} errors={titleErrors?.map((message) => ({ message }))} />
        </Field>
        <Field data-invalid={contentErrors || over ? true : undefined}>
          <FieldLabel htmlFor={contentId}>Texto</FieldLabel>
          <Textarea
            id={contentId}
            value={contentMd}
            onChange={(event) => setContentMd(event.target.value)}
            spellCheck
            className="max-h-[50vh] min-h-56 font-mono text-sm"
            aria-invalid={contentErrors || over ? true : undefined}
            aria-describedby={`${contentId}-tokens${contentErrors ? ` ${contentId}-error` : ""}`}
          />
          <FieldDescription
            id={`${contentId}-tokens`}
            aria-live="polite"
            className={cn("tabular-nums", over ? "text-destructive-text" : level === "warning" || level === "full" ? "text-warning" : undefined)}
          >
            {formatNumber(tokens)} tokens. Con los demás archivos de este agente, {formatNumber(total)} de {formatNumber(limits.maxTokens)}.
            {over
              ? " Pasa del tope: recorta el texto o súbelo a una base de conocimiento, donde el agente busca solo lo que necesita."
              : level !== "ok"
                ? " Cerca del tope: todo este texto se envía al modelo en cada mensaje."
                : null}
          </FieldDescription>
          <FieldError id={`${contentId}-error`} errors={contentErrors?.map((message) => ({ message }))} />
        </Field>
      </FieldGroup>
      <FormMessage result={general} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          {pending ? "Guardando…" : creating ? "Añadir archivo" : "Guardar cambios"}
        </Button>
      </DialogFooter>
    </form>
  );
}
