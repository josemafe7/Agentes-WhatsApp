"use client";
// «Nueva plantilla» ([WA-57]–[WA-59], [CUM-14]): starts from one of the two models of the app or from scratch; the text
// takes the data that fills itself with «Insertar dato»; the preview shows it with Meta's examples; while writing a
// utility one it warns of what makes Meta move it to marketing, and in health sectors of health data. What Meta would
// refuse is said by field before sending. The server checks it all again.
import { FilePlus2, LoaderCircle, Plus, Trash2, TriangleAlert } from "lucide-react";
import { useId, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ActionFailure } from "@/lib/action-result";
import type { TemplateButtonRole } from "@/lib/enums";
import {
  draftErrors,
  TEMPLATE_BUTTON_MAX,
  TEMPLATE_BUTTONS_MAX,
  TEMPLATE_FIELDS,
  templateModels,
  utilityWarnings,
  type TemplateDraft,
} from "@/lib/whatsapp-template-draft";
import { createWhatsAppTemplateAction } from "./actions";

const LANGUAGES = [
  { code: "es_ES", label: "Español (España)" },
  { code: "es", label: "Español" },
  { code: "es_MX", label: "Español (México)" },
  { code: "es_AR", label: "Español (Argentina)" },
  { code: "ca", label: "Catalán" },
] as const;
const TTL_CHOICES = [
  { value: "none", label: "La de Meta (30 días)" },
  { value: "1800", label: "30 minutos" },
  { value: "3600", label: "1 hora" },
  { value: "7200", label: "2 horas" },
  { value: "21600", label: "6 horas" },
  { value: "43200", label: "12 horas" },
] as const;
const ROLE_LABELS: Record<TemplateButtonRole | "none", string> = {
  none: "Solo responde",
  confirm: "Confirmo (la cita)",
  change: "Necesito cambiarla",
  marketing_opt_out: "Baja de publicidad",
};
const EMPTY: TemplateDraft = { name: "", language: "es_ES", category: "UTILITY", header: "", body: "", footer: "", buttons: [], ttlSeconds: null };

function preview(text: string, businessName: string): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (whole, name: string) => {
    const field = TEMPLATE_FIELDS.find((item) => item.variable === name);
    if (!field) return whole;
    return field.key === "business.name" ? businessName : field.example;
  });
}

type NewTemplateDialogProps = { channelId: string; healthData: boolean; businessName: string };

export function NewTemplateDialog({ channelId, healthData, businessName }: NewTemplateDialogProps) {
  const id = useId();
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const models = useMemo(() => templateModels({ healthData }), [healthData]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<TemplateDraft>(models[0].draft);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const errors = draftErrors(draft);
  const warnings = utilityWarnings(draft, { healthData });
  const set = (patch: Partial<TemplateDraft>) => setDraft((current) => ({ ...current, ...patch }));

  function insertField(variable: string) {
    const area = bodyRef.current;
    const token = `{{${variable}}}`;
    const start = area?.selectionStart ?? draft.body.length;
    const end = area?.selectionEnd ?? draft.body.length;
    set({ body: `${draft.body.slice(0, start)}${token}${draft.body.slice(end)}` });
    requestAnimationFrame(() => {
      area?.focus();
      area?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  function submit() {
    startTransition(async () => {
      const result = await createWhatsAppTemplateAction(channelId, draft);
      if (!result.ok) {
        setFailure(result);
        return;
      }
      toast.success(result.message ?? "Plantilla creada.");
      setOpen(false);
    });
  }

  const fieldError = (name: keyof typeof errors) => errors[name] ?? failure?.fieldErrors?.[name]?.[0];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (next) {
          setFailure(null);
          setDraft(models[0].draft);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button">
          <FilePlus2 aria-hidden />
          Nueva plantilla
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nueva plantilla</DialogTitle>
          <DialogDescription>Se envía a Meta para que la revise (suele tardar minutos, como mucho 24 horas). Para editarla o borrarla después, en WhatsApp Manager.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">Empezar con</legend>
            <div className="flex flex-wrap gap-2">
              {models.map((model) => (
                <Button key={model.id} type="button" size="sm" variant="outline" onClick={() => setDraft(model.draft)}>
                  {model.label}
                </Button>
              ))}
              <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(EMPTY)}>
                En blanco
              </Button>
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2 sm:col-span-3">
              <Label htmlFor={`${id}-nombre`}>Nombre</Label>
              <Input id={`${id}-nombre`} value={draft.name} onChange={(event) => set({ name: event.target.value })} aria-invalid={Boolean(fieldError("name"))} aria-describedby={fieldError("name") ? `${id}-nombre-error` : undefined} />
              <FieldError id={`${id}-nombre-error`} errors={fieldError("name") ? [{ message: fieldError("name") }] : undefined} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-idioma`}>Idioma</Label>
              <Select value={draft.language} onValueChange={(language) => set({ language })}>
                <SelectTrigger id={`${id}-idioma`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((language) => (
                    <SelectItem key={language.code} value={language.code}>
                      {language.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-categoria`}>Categoría</Label>
              <Select
                value={draft.category}
                onValueChange={(category) => set({ category: category as TemplateDraft["category"], ttlSeconds: category === "UTILITY" ? draft.ttlSeconds : null })}
              >
                <SelectTrigger id={`${id}-categoria`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="UTILITY">Utilidad (avisos de una cita)</SelectItem>
                  <SelectItem value="MARKETING">Marketing (novedades y publicidad)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {draft.category === "UTILITY" ? (
              <div className="grid gap-2">
                <Label htmlFor={`${id}-caducidad`}>Caducidad</Label>
                <Select value={draft.ttlSeconds === null ? "none" : String(draft.ttlSeconds)} onValueChange={(value) => set({ ttlSeconds: value === "none" ? null : Number(value) })}>
                  <SelectTrigger id={`${id}-caducidad`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TTL_CHOICES.map((choice) => (
                      <SelectItem key={choice.value} value={choice.value}>
                        {choice.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>
          {draft.category === "UTILITY" ? (
            <p className="text-xs text-muted-foreground">Si Meta no la puede entregar en ese tiempo (por ejemplo, con el móvil apagado), ya no la entrega: así un recordatorio no llega tarde.</p>
          ) : null}

          <div className="grid gap-2">
            <Label htmlFor={`${id}-encabezado`}>Encabezado (opcional)</Label>
            <Input id={`${id}-encabezado`} value={draft.header} onChange={(event) => set({ header: event.target.value })} aria-invalid={Boolean(fieldError("header"))} aria-describedby={fieldError("header") ? `${id}-encabezado-error` : undefined} />
            <FieldError id={`${id}-encabezado-error`} errors={fieldError("header") ? [{ message: fieldError("header") }] : undefined} />
          </div>

          <div className="grid gap-2">
            <Label htmlFor={`${id}-texto`}>Texto</Label>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Insertar dato">
              {TEMPLATE_FIELDS.map((field) => (
                <Button key={field.key} type="button" size="sm" variant="secondary" onClick={() => insertField(field.variable)}>
                  <Plus aria-hidden />
                  {field.label}
                </Button>
              ))}
            </div>
            <Textarea ref={bodyRef} id={`${id}-texto`} rows={5} value={draft.body} onChange={(event) => set({ body: event.target.value })} aria-invalid={Boolean(fieldError("body"))} aria-describedby={fieldError("body") ? `${id}-texto-error` : undefined} />
            <FieldError id={`${id}-texto-error`} errors={fieldError("body") ? [{ message: fieldError("body") }] : undefined} />
          </div>

          <div className="grid gap-2">
            <Label htmlFor={`${id}-pie`}>Pie (opcional)</Label>
            <Input id={`${id}-pie`} value={draft.footer} onChange={(event) => set({ footer: event.target.value })} aria-invalid={Boolean(fieldError("footer"))} aria-describedby={fieldError("footer") ? `${id}-pie-error` : undefined} />
            <FieldError id={`${id}-pie-error`} errors={fieldError("footer") ? [{ message: fieldError("footer") }] : undefined} />
          </div>

          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">Botones de respuesta rápida (como mucho {TEMPLATE_BUTTON_MAX} caracteres)</legend>
            {draft.buttons.map((button, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem_auto]">
                <Input
                  aria-label={`Texto del botón ${index + 1}`}
                  value={button.text}
                  maxLength={TEMPLATE_BUTTON_MAX + 10}
                  onChange={(event) => set({ buttons: draft.buttons.map((item, at) => (at === index ? { ...item, text: event.target.value } : item)) })}
                />
                <Select
                  value={button.role ?? "none"}
                  onValueChange={(value) => set({ buttons: draft.buttons.map((item, at) => (at === index ? { ...item, role: value === "none" ? null : (value as TemplateButtonRole) } : item)) })}
                >
                  <SelectTrigger aria-label={`Qué hace el botón ${index + 1}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(ROLE_LABELS) as (TemplateButtonRole | "none")[]).map((role) => (
                      <SelectItem key={role} value={role}>
                        {ROLE_LABELS[role]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" variant="ghost" size="icon" aria-label={`Quitar el botón ${index + 1}`} onClick={() => set({ buttons: draft.buttons.filter((_, at) => at !== index) })}>
                  <Trash2 aria-hidden />
                </Button>
              </div>
            ))}
            {draft.buttons.length < TEMPLATE_BUTTONS_MAX ? (
              <div>
                <Button type="button" size="sm" variant="outline" onClick={() => set({ buttons: [...draft.buttons, { text: "", role: null }] })}>
                  <Plus aria-hidden />
                  Añadir botón
                </Button>
              </div>
            ) : null}
            <FieldError errors={fieldError("buttons") ? [{ message: fieldError("buttons") }] : undefined} />
          </fieldset>

          {warnings.length > 0 ? (
            <div role="status" className="grid gap-1 rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm">
              {warnings.map((warning) => (
                <p key={warning} className="flex items-start gap-2">
                  <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
                  {warning}
                </p>
              ))}
            </div>
          ) : null}

          <div className="grid gap-1 rounded-lg bg-muted p-3 text-sm">
            <p className="text-xs font-medium text-muted-foreground">Así la verá el cliente (con datos de ejemplo)</p>
            {draft.header.trim() ? <p className="font-semibold">{preview(draft.header, businessName)}</p> : null}
            <p className="whitespace-pre-wrap">{preview(draft.body, businessName) || "—"}</p>
            {draft.footer.trim() ? <p className="text-xs text-muted-foreground">{draft.footer}</p> : null}
            {draft.buttons.length ? (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {draft.buttons.map((button, index) => (
                  <span key={index} className="rounded-full border bg-background px-2.5 py-0.5 text-xs">
                    {button.text || "…"}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <FormMessage result={failure ?? undefined} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending || Object.keys(errors).length > 0} aria-busy={pending}>
              {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
              {pending ? "Enviando…" : "Enviar a Meta"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
