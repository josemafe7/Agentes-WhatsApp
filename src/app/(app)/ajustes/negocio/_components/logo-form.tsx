"use client";

import { ImageUp, LoaderCircle, Trash2 } from "lucide-react";
import { useActionState, useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action-result";
import { removeLogoAction, uploadLogoAction } from "../actions";

type LogoFormProps = { logoUrl: string | null; businessName: string; maxBytes: number };

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? "")
      .join("") || "·"
  );
}

/** Logo of the business: PNG, JPG or WebP. The server checks the real type and size again ([SEG-13]). */
export function LogoForm({ logoUrl, businessName, maxBytes }: LogoFormProps) {
  const [state, formAction] = useActionState<ActionResult | undefined, FormData>(uploadLogoAction, undefined);
  const [pending, startTransition] = useTransition();
  const [clientError, setClientError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const serverErrors = state && !state.ok ? state.fieldErrors?.logo : undefined;
  const errors = clientError ? [clientError] : serverErrors;
  const maxKb = Math.round(maxBytes / 1024);

  // Clear the chosen file once it is saved.
  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const file = data.get("logo");
    if (!(file instanceof File) || file.size === 0) return setClientError("Elige una imagen.");
    if (!ACCEPTED_TYPES.includes(file.type)) return setClientError("El logo tiene que ser una imagen PNG, JPG o WebP.");
    if (file.size > maxBytes) return setClientError(`El logo puede ocupar como mucho ${maxKb} KB.`);
    setClientError(null);
    startTransition(() => formAction(data));
  }

  async function removeLogo() {
    const result = await removeLogoAction();
    if (result.ok) toast.success(result.message ?? "Logo quitado.");
    else toast.error(result.error);
  }

  return (
    <div className="flex max-w-[640px] flex-col gap-4 sm:flex-row sm:items-start">
      <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-muted">
        {logoUrl ? (
          // Served by /api/files; the key changes on every upload.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={`Logo de ${businessName || "tu negocio"}`} className="size-full object-contain" />
        ) : (
          <span aria-hidden className="text-lg font-semibold text-muted-foreground">
            {initials(businessName)}
          </span>
        )}
      </div>
      <form ref={formRef} onSubmit={handleSubmit} noValidate className="min-w-0 flex-1 space-y-3">
        <Field data-invalid={errors ? true : undefined}>
          <FieldLabel htmlFor="business-logo">{logoUrl ? "Cambiar el logo" : "Subir un logo"}</FieldLabel>
          <Input
            id="business-logo"
            name="logo"
            type="file"
            accept={ACCEPTED_TYPES.join(",")}
            onChange={() => setClientError(null)}
            aria-invalid={errors ? true : undefined}
            aria-describedby="business-logo-help"
          />
          <FieldDescription id="business-logo-help">
            PNG, JPG o WebP de hasta {maxKb} KB, mejor cuadrado. Sin logo se muestran las iniciales del negocio.
          </FieldDescription>
          <FieldError errors={errors?.map((message) => ({ message }))} />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="outline" disabled={pending}>
            {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <ImageUp aria-hidden />}
            {pending ? "Subiendo…" : "Subir logo"}
          </Button>
          {logoUrl ? (
            <ConfirmDialog
              trigger={
                <Button type="button" variant="ghost">
                  <Trash2 aria-hidden />
                  Quitar logo
                </Button>
              }
              title="¿Quitar el logo?"
              description="En su lugar se verán las iniciales del negocio. Puedes subir otro cuando quieras."
              confirmLabel="Quitar logo"
              destructive
              onConfirm={removeLogo}
            />
          ) : null}
          {state?.ok ? <FormMessage result={state} /> : null}
        </div>
      </form>
    </div>
  );
}
