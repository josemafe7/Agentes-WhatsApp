"use client";

import { LoaderCircle, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import type { ActionFailure } from "@/lib/action-result";
import { TextField } from "../../../../_components/form-fields";
import { renameKnowledgeDocumentAction } from "../../../actions";

type RenameDocumentDialogProps = { documentId: string; title: string };

/**
 * «Cambiar título» of a file, web page or text ([CON-10]): the agents read the title before every fragment, so saving
 * it processes the fragments again in the background (the server checks the permission and the limit again).
 */
export function RenameDocumentDialog({ documentId, title }: RenameDocumentDialogProps) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    // A fresh form (and result) every time the dialog opens.
    if (next) setFormKey((key) => key + 1);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          <Pencil aria-hidden />
          Cambiar título
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <RenameDocumentForm key={formKey} documentId={documentId} title={title} onClose={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function RenameDocumentForm({ documentId, title, onClose }: RenameDocumentDialogProps & { onClose: () => void }) {
  const router = useRouter();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = { title: String(new FormData(event.currentTarget).get("title") ?? "") };
    startTransition(async () => {
      const result = await renameKnowledgeDocumentAction(documentId, input);
      if (!result.ok) {
        setFailure(result);
        return;
      }
      toast.success(result.message ?? "Título guardado.");
      onClose();
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Cambiar el título</DialogTitle>
        <DialogDescription>
          Los agentes lo leen delante de cada fragmento («Documento: título &gt; sección»). Al guardarlo, los fragmentos se actualizan en segundo plano.
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <TextField id="document-title-input" name="title" label="Título" autoComplete="off" maxLength={300} defaultValue={title} errors={failure?.fieldErrors?.title} />
      </FieldGroup>
      <FormMessage result={failure ?? undefined} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          {pending ? "Guardando…" : "Guardar título"}
        </Button>
      </DialogFooter>
    </form>
  );
}
