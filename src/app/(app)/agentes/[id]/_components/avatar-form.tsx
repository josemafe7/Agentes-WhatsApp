"use client";

import { ImageUp, LoaderCircle, Trash2 } from "lucide-react";
import { useActionState, useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action-result";
import { AgentAvatar } from "../../_components/agent-avatar";
import { removeAgentAvatarAction, uploadAgentAvatarAction } from "../actions";

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];

type AvatarFormProps = { agentId: string; name: string; avatarUrl: string | null; maxBytes: number };

/** Avatar: PNG, JPG or WebP; saved at once as a new version. The server checks the real type and size ([SEG-13]). */
export function AvatarForm({ agentId, name, avatarUrl, maxBytes }: AvatarFormProps) {
  const [state, formAction] = useActionState<ActionResult | undefined, FormData>(uploadAgentAvatarAction.bind(null, agentId), undefined);
  const [pending, startTransition] = useTransition();
  const [clientError, setClientError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const errors = clientError ? [clientError] : state && !state.ok ? (state.fieldErrors?.avatar ?? [state.error]) : undefined;
  const maxKb = Math.round(maxBytes / 1024);

  useEffect(() => {
    if (!state?.ok) return;
    formRef.current?.reset();
    toast.success(state.message ?? "Avatar actualizado.");
  }, [state]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const file = data.get("avatar");
    if (!(file instanceof File) || file.size === 0) return setClientError("Elige una imagen.");
    if (!ACCEPTED_TYPES.includes(file.type)) return setClientError("La imagen tiene que ser PNG, JPG o WebP.");
    if (file.size > maxBytes) return setClientError(`La imagen puede ocupar como mucho ${maxKb} KB.`);
    setClientError(null);
    startTransition(() => formAction(data));
  }

  async function remove() {
    const result = await removeAgentAvatarAction(agentId);
    if (result.ok) toast.success(result.message ?? "Avatar quitado.");
    else toast.error(result.error);
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4 sm:flex-row sm:items-start">
      <AgentAvatar name={name} src={avatarUrl} className="size-16 text-lg" />
      <form ref={formRef} onSubmit={handleSubmit} noValidate className="min-w-0 flex-1 space-y-3">
        <Field data-invalid={errors ? true : undefined}>
          <FieldLabel htmlFor="agent-avatar">{avatarUrl ? "Cambiar el avatar" : "Avatar (opcional)"}</FieldLabel>
          <Input
            id="agent-avatar"
            name="avatar"
            type="file"
            accept={ACCEPTED_TYPES.join(",")}
            onChange={() => setClientError(null)}
            aria-invalid={errors ? true : undefined}
            aria-describedby="agent-avatar-help"
          />
          <FieldDescription id="agent-avatar-help">PNG, JPG o WebP de hasta {maxKb} KB, mejor cuadrada. Sin imagen se ven sus iniciales.</FieldDescription>
          <FieldError errors={errors?.map((message) => ({ message }))} />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="outline" disabled={pending}>
            {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <ImageUp aria-hidden />}
            {pending ? "Subiendo…" : "Subir imagen"}
          </Button>
          {avatarUrl ? (
            <ConfirmDialog
              trigger={
                <Button type="button" variant="ghost">
                  <Trash2 aria-hidden />
                  Quitar avatar
                </Button>
              }
              title="¿Quitar el avatar?"
              description="En su lugar se verán las iniciales del agente. Se guarda como una versión nueva."
              confirmLabel="Quitar avatar"
              destructive
              onConfirm={remove}
            />
          ) : null}
        </div>
      </form>
    </div>
  );
}
