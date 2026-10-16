"use client";

import { LoaderCircle, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { ActionFailure } from "@/lib/action-result";
import type { Audience } from "@/lib/enums";
import { createKnowledgeBaseAction } from "../actions";
import { knowledgeBasePath } from "../_lib/paths";
import { TextAreaField, TextField } from "./form-fields";

/**
 * «Nueva base» (docs/pantallas.md): name and description; then the base opens to add content. Who manages internal
 * bases also chooses who it is for, once ([INT-04]).
 */
export function NewBaseDialog({ canCreateInternal = false }: { canCreateInternal?: boolean }) {
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
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-md">
        <NewBaseForm key={formKey} onClose={() => setOpen(false)} canCreateInternal={canCreateInternal} />
      </DialogContent>
    </Dialog>
  );
}

const AUDIENCE_OPTIONS: { value: Audience; label: string; description: string }[] = [
  { value: "customers", label: "Para clientes", description: "La usan los agentes que atienden a tus clientes." },
  { value: "team", label: "Interna", description: "Solo la usan los agentes internos. Un agente de clientes nunca puede leerla." },
];

function NewBaseForm({ onClose, canCreateInternal }: { onClose: () => void; canCreateInternal: boolean }) {
  const router = useRouter();
  const [audience, setAudience] = useState<Audience>("customers");
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const errors = failure?.fieldErrors;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input = { name: String(data.get("name") ?? ""), description: String(data.get("description") ?? ""), audience };
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
        {canCreateInternal ? (
          <FieldSet data-invalid={errors?.audience ? true : undefined}>
            <FieldLegend variant="label">Uso</FieldLegend>
            <RadioGroup
              value={audience}
              onValueChange={(value) => {
                const option = AUDIENCE_OPTIONS.find((candidate) => candidate.value === value);
                if (option) setAudience(option.value);
              }}
              className="grid gap-2"
            >
              {AUDIENCE_OPTIONS.map((option) => (
                <div key={option.value} className="flex items-start gap-3 rounded-lg border p-3 has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary-soft">
                  <RadioGroupItem id={`new-base-audience-${option.value}`} value={option.value} className="mt-0.5" aria-describedby={`new-base-audience-${option.value}-help`} />
                  <div className="grid gap-1">
                    <FieldLabel htmlFor={`new-base-audience-${option.value}`}>{option.label}</FieldLabel>
                    <FieldDescription id={`new-base-audience-${option.value}-help`}>{option.description}</FieldDescription>
                  </div>
                </div>
              ))}
            </RadioGroup>
            <FieldDescription>No se puede cambiar después.</FieldDescription>
            <FieldError errors={errors?.audience?.map((message) => ({ message }))} />
          </FieldSet>
        ) : null}
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
