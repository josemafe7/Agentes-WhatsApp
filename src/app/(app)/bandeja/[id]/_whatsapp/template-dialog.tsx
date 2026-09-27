"use client";

import { FileText, LoaderCircle, SendHorizontal } from "lucide-react";
import { useId, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { WhatsAppInboxTemplate } from "@/data/whatsapp-send";
import { requestRealtimePoll } from "@/hooks/use-realtime";
import { ACTION_FAILED } from "../../_components/use-inbox-action";
import { sendTemplateAction } from "./actions";
import { isChargedTemplateCategory, pricingCategoryLabel } from "./presentation";
import { MAX_TEMPLATE_VALUE, templateForm, templatePreview, templateValueErrors, templateValuesToSend } from "./template-form";

type TemplateDialogProps = { conversationId: string; templates: WhatsAppInboxTemplate[] };

/**
 * «Elegir plantilla» ([WA-42], [WA-43], [BAN-08]): an APPROVED template of the number, with its language and category
 * (and whether Meta charges it), a field for each variable and the message as the customer will read it. The server
 * checks everything again. What was written stays if the dialog is closed or the send fails.
 */
export function TemplateDialog({ conversationId, templates }: TemplateDialogProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const template = templates.find((item) => item.id === templateId) ?? null;
  const form = template ? templateForm(template.components) : null;
  const preview = template ? templatePreview(template.components, values) : null;
  const category = template ? pricingCategoryLabel(template.category) : null;

  function choose(value: string) {
    setTemplateId(value);
    setValues({});
    setErrors({});
    setError(null);
  }

  function change(name: string, value: string) {
    setValues((previous) => ({ ...previous, [name]: value }));
    setErrors((previous) => {
      const next = { ...previous };
      delete next[name];
      return next;
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!template || !form || pending) return;
    const found = templateValueErrors(form, values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const input = { conversationId, templateId: template.id, values: templateValuesToSend(form, values) };
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof sendTemplateAction>> | null;
      try {
        result = await sendTemplateAction(input);
      } catch {
        result = null;
      }
      if (!result?.ok) {
        setError(result?.error ?? ACTION_FAILED);
        return;
      }
      setOpen(false);
      choose("");
      requestRealtimePoll();
      if (result.data?.status === "failed") {
        toast.error("No se ha podido enviar la plantilla. Puedes reintentarlo desde el propio mensaje.", { duration: Infinity });
      } else {
        toast.success("Plantilla enviada.");
      }
    });
  }

  return (
    <>
      <Button type="button" size="sm" className="w-fit shrink-0" onClick={() => setOpen(true)}>
        <FileText aria-hidden />
        Elegir plantilla
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Enviar una plantilla</DialogTitle>
            <DialogDescription>
              Fuera de la ventana de 24 h, WhatsApp solo deja escribir al cliente con una plantilla aprobada por Meta. Como cualquier respuesta tuya, pausa
              la IA en esta conversación.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={`${id}-plantilla`}>Plantilla</FieldLabel>
                <Select value={templateId} onValueChange={choose}>
                  <SelectTrigger id={`${id}-plantilla`} className="w-full" aria-describedby={template ? `${id}-categoria` : undefined}>
                    <SelectValue placeholder="Elige una plantilla aprobada" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name} · {item.language}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {template ? (
                  <FieldDescription id={`${id}-categoria`} className="flex flex-col gap-1.5">
                    <span className="flex flex-wrap gap-1.5">
                      <Badge variant="outline">Idioma: {template.language}</Badge>
                      {category ? <Badge variant="outline">Categoría: {category}</Badge> : null}
                    </span>
                    {isChargedTemplateCategory(template.category)
                      ? `Meta cobra las plantillas de ${category?.toLowerCase()} según la tarifa del país del cliente. El coste estimado aparece en el mensaje cuando Meta lo confirma.`
                      : null}
                  </FieldDescription>
                ) : null}
              </Field>

              {form?.headerMedia ? (
                <p role="alert" className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
                  {templateValueErrors(form, values).header}
                </p>
              ) : (
                form?.fields.map((field) => {
                  const fieldId = `${id}-var-${field.name}`;
                  const fieldError = errors[field.name];
                  return (
                    <Field key={field.name} data-invalid={fieldError ? true : undefined}>
                      <FieldLabel htmlFor={fieldId}>
                        {`{{${field.name}}}`}
                        <span className="font-normal text-muted-foreground">{field.part === "header" ? " · cabecera" : " · texto"}</span>
                      </FieldLabel>
                      <Input
                        id={fieldId}
                        value={values[field.name] ?? ""}
                        maxLength={MAX_TEMPLATE_VALUE}
                        autoComplete="off"
                        onChange={(event) => change(field.name, event.target.value)}
                        aria-invalid={fieldError ? true : undefined}
                      />
                      <FieldError errors={fieldError ? [{ message: fieldError }] : undefined} />
                    </Field>
                  );
                })
              )}
            </FieldGroup>

            {preview ? (
              <section aria-label="Vista previa" className="flex flex-col items-end gap-1.5">
                <p className="text-xs text-muted-foreground">Así lo verá el cliente</p>
                <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm break-words text-primary-foreground">
                  {preview.header ? <p className="font-semibold">{preview.header}</p> : null}
                  <p className="whitespace-pre-wrap">{preview.body}</p>
                  {preview.footer ? <p className="mt-1 text-xs opacity-80">{preview.footer}</p> : null}
                </div>
                {preview.buttons.length > 0 ? (
                  <ul className="flex max-w-[85%] flex-wrap justify-end gap-1.5" aria-label="Botones de la plantilla">
                    {preview.buttons.map((button, index) => (
                      <li key={`${index}-${button}`} className="rounded-full border px-2.5 py-0.5 text-xs">
                        {button}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ) : null}

            {error ? (
              <p role="alert" className="text-sm text-destructive-text">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={!template || Boolean(form?.headerMedia) || pending}>
                {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <SendHorizontal aria-hidden />}
                Enviar plantilla
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
