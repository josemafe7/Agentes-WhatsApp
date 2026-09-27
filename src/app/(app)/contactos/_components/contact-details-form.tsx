"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import type { ActionFailure } from "@/lib/action-result";
import { updateContactAction } from "../actions";
import { ContactTextField } from "./contact-text-field";

export type ContactDetailsValues = { name: string; phone: string; email: string; notes: string };

/** «Datos» of the card ([CTO-02]): name, phone, email and notes. The phone is data, never how we recognise them. */
export function ContactDetailsForm({ contactId, initial }: { contactId: string; initial: ContactDetailsValues }) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = JSON.stringify(values) !== JSON.stringify(saved);
  const errors = failure?.fieldErrors;

  const set = (field: keyof ContactDetailsValues) => (value: string) => setValues((current) => ({ ...current, [field]: value }));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !dirty) return;
    startTransition(async () => {
      const result = await updateContactAction(contactId, values);
      if (!result.ok) {
        setFailure(result);
        return;
      }
      setFailure(null);
      setSaved(values);
      toast.success(result.message ?? "Cambios guardados.");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-6">
      <FieldGroup>
        <ContactTextField id="contact-name" label="Nombre" optional autoComplete="off" value={values.name} onChange={(event) => set("name")(event.target.value)} errors={errors?.name} />
        <div className="grid gap-6 sm:grid-cols-2">
          <ContactTextField id="contact-phone" label="Teléfono" type="tel" optional autoComplete="off" value={values.phone} onChange={(event) => set("phone")(event.target.value)} errors={errors?.phone} />
          <ContactTextField id="contact-email" label="Email" type="email" optional autoComplete="off" value={values.email} onChange={(event) => set("email")(event.target.value)} errors={errors?.email} />
        </div>
        <Field data-invalid={errors?.notes ? true : undefined}>
          <FieldLabel htmlFor="contact-notes">
            Notas <span className="font-normal text-muted-foreground">(opcional)</span>
          </FieldLabel>
          <Textarea
            id="contact-notes"
            rows={3}
            value={values.notes}
            onChange={(event) => set("notes")(event.target.value)}
            aria-invalid={errors?.notes ? true : undefined}
            aria-describedby={errors?.notes ? "contact-notes-error" : undefined}
          />
          <FieldError id="contact-notes-error" errors={errors?.notes?.map((message) => ({ message }))} />
        </Field>
      </FieldGroup>
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={pending || !dirty}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          {pending ? "Guardando…" : "Guardar cambios"}
        </Button>
        {dirty && !pending ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setValues(saved);
              setFailure(null);
            }}
          >
            Descartar
          </Button>
        ) : null}
        <FormMessage result={failure ?? undefined} />
      </div>
    </form>
  );
}
