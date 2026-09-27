"use client";

import { LoaderCircle, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import type { ActionFailure } from "@/lib/action-result";
import { createKnowledgeBaseAction } from "../actions";
import { knowledgeBasePath } from "../_lib/paths";
import { TextAreaField, TextField } from "./form-fields";

/** «Nueva base» (docs/pantallas.md): name and description; then the base opens to add content. */
export function NewBaseDialog() {
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
        <Button>
          <Plus aria-hidden />
          Nueva base
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <NewBaseForm key={formKey} onClose={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function NewBaseForm({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const errors = failure?.fieldErrors;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input = { name: String(data.get("name") ?? ""), description: String(data.get("description") ?? "") };
    startTransition(async () => {
      const result = await createKnowledgeBaseAction(input);
      if (!result.ok) {
        setFailure(result);
        return;
      }
      toast.success(result.message ?? "Base creada.");
      onClose();
      if (result.data) router.push(knowledgeBasePath(result.data.id));
    });
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Nueva base de conocimiento</DialogTitle>
        <DialogDescription>Después podrás subir documentos, añadir páginas web y escribir preguntas frecuentes.</DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <TextField id="new-base-name" name="name" label="Nombre" autoComplete="off" maxLength={120} errors={errors?.name} placeholder="Por ejemplo, Servicios y precios" />
        <TextAreaField
          id="new-base-description"
          name="description"
          label="Descripción"
          optional
          rows={3}
          maxLength={1000}
          errors={errors?.description}
          help="Para qué sirve esta base. Solo la ve tu equipo."
        />
      </FieldGroup>
      <FormMessage result={failure ?? undefined} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          {pending ? "Creando…" : "Crear base"}
        </Button>
      </DialogFooter>
    </form>
  );
}
