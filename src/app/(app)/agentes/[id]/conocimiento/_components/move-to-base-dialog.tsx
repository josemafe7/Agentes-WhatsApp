"use client";

import { LoaderCircle } from "lucide-react";
import { useId, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ActionFailure } from "@/lib/action-result";
import { moveContextFileToBaseAction } from "../actions";

/** Value of the «Nueva base» option (never a base id, which is a UUID). */
const NEW_BASE = "new";

type MoveToBaseDialogProps = {
  agentId: string;
  file: { id: string; title: string } | null;
  bases: { id: string; name: string }[];
  onClose: () => void;
};

/**
 * «Pasar a una base de conocimiento» ([CON-02]): the text becomes a document of an existing or new base, the agent
 * starts using that base and the context file goes, so it no longer travels whole in every message.
 */
export function MoveToBaseDialog({ agentId, file, bases, onClose }: MoveToBaseDialogProps) {
  return (
    <Dialog open={file !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md">{file ? <MoveForm key={file.id} agentId={agentId} file={file} bases={bases} onClose={onClose} /> : null}</DialogContent>
    </Dialog>
  );
}

function MoveForm({ agentId, file, bases, onClose }: MoveToBaseDialogProps & { file: { id: string; title: string } }) {
  const [target, setTarget] = useState(bases[0]?.id ?? NEW_BASE);
  const [newName, setNewName] = useState(file.title);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const baseId = useId();
  const nameId = useId();
  const errors = failure?.fieldErrors;
  const baseErrors = errors?.kbId;
  const nameErrors = errors?.name ?? errors?.newBaseName;
  const creating = target === NEW_BASE;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    startTransition(async () => {
      const result = await moveContextFileToBaseAction(
        creating ? { agentId, fileId: file.id, newBaseName: newName } : { agentId, fileId: file.id, kbId: target },
      );
      if (!result.ok) {
        setFailure(result);
        return;
      }
      toast.success(result.message ?? "Archivo pasado a la base.");
      onClose();
    });
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle className="pr-8 break-words">¿Pasar «{file.title}» a una base de conocimiento?</DialogTitle>
        <DialogDescription>
          Dejará de ir entero en cada mensaje: se añade a la base como documento, el agente pasa a usar esa base y busca en ella solo lo que
          necesita. Se quita de los archivos de contexto.
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field data-invalid={baseErrors ? true : undefined}>
          <FieldLabel htmlFor={baseId}>Base de conocimiento</FieldLabel>
          <Select
            value={target}
            onValueChange={(value) => {
              setTarget(value);
              setFailure(null);
            }}
          >
            <SelectTrigger id={baseId} className="w-full" aria-invalid={baseErrors ? true : undefined}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {bases.map((base) => (
                <SelectItem key={base.id} value={base.id}>
                  {base.name}
                </SelectItem>
              ))}
              {bases.length > 0 ? <SelectSeparator /> : null}
              <SelectItem value={NEW_BASE}>Nueva base…</SelectItem>
            </SelectContent>
          </Select>
          <FieldError errors={baseErrors?.map((message) => ({ message }))} />
        </Field>
        {creating ? (
          <Field data-invalid={nameErrors ? true : undefined}>
            <FieldLabel htmlFor={nameId}>Nombre de la base nueva</FieldLabel>
            <Input
              id={nameId}
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              maxLength={120}
              autoComplete="off"
              aria-invalid={nameErrors ? true : undefined}
              aria-describedby={nameErrors ? `${nameId}-error` : `${nameId}-help`}
            />
            <FieldDescription id={`${nameId}-help`}>Podrás añadirle más documentos, webs y preguntas frecuentes en Conocimiento.</FieldDescription>
            <FieldError id={`${nameId}-error`} errors={nameErrors?.map((message) => ({ message }))} />
          </Field>
        ) : null}
      </FieldGroup>
      <FormMessage result={failure && !baseErrors && !nameErrors ? failure : undefined} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          {pending ? "Pasando…" : "Pasar a la base"}
        </Button>
      </DialogFooter>
    </form>
  );
}
