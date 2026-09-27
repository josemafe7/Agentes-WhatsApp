"use client";

import { LoaderCircle, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import type { ActionFailure } from "@/lib/action-result";
import { createContactAction } from "../actions";
import { contactPath } from "../_lib/search-params";
import { ContactTextField } from "./contact-text-field";

/** «Nuevo contacto» ([CTO-01]): name, phone or email; then its card opens to add labels and fields. */
export function NewContactDialog() {
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
          <UserPlus aria-hidden />
          Nuevo contacto
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <NewContactForm key={formKey} onClose={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function NewContactForm({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const errors = failure?.fieldErrors;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input = { name: String(data.get("name") ?? ""), phone: String(data.get("phone") ?? ""), email: String(data.get("email") ?? "") };
    startTransition(async () => {
      const result = await createContactAction(input);
      if (!result.ok) {
        setFailure(result);
        return;
      }
      toast.success(result.message ?? "Contacto creado.");
      onClose();
      if (result.data) router.push(contactPath(result.data.id));
    });
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Nuevo contacto</DialogTitle>
        <DialogDescription>Escribe al menos el nombre, el teléfono o el email. Las etiquetas y los campos se añaden en su ficha.</DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <ContactTextField id="new-contact-name" name="name" label="Nombre" optional autoComplete="off" errors={errors?.name} />
        <ContactTextField id="new-contact-phone" name="phone" label="Teléfono" type="tel" optional autoComplete="off" errors={errors?.phone} />
        <ContactTextField id="new-contact-email" name="email" label="Email" type="email" optional autoComplete="off" errors={errors?.email} />
      </FieldGroup>
      <FormMessage result={failure ?? undefined} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          {pending ? "Creando…" : "Crear contacto"}
        </Button>
      </DialogFooter>
    </form>
  );
}
