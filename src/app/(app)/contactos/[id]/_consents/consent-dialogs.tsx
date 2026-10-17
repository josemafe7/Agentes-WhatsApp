"use client";
// The consent dialogs of the card ([CTO-08]–[CTO-10]): mark or withdraw a permission saying how the customer gave it,
// record a baja the customer asked for by another way, and lift a baja only when the customer asks. Who and when are
// recorded by the server; these only send what the person chose.
import { BellOff, BellRing, Check, LoaderCircle, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { fail, type ActionFailure, type ActionResult } from "@/lib/action-result";
import { CHANNEL_KIND_LABELS, CONSENT_METHOD_LABELS, PERMISSION_LABELS, type OptOutScope } from "@/lib/consents";
import { CONSENT_METHODS, type ChannelKind, type ConsentMethod, type ContactPermission } from "@/lib/enums";
import { liftOptOutAction, recordOptOutAction, setPermissionAction } from "./actions";

/** Same limit as the consents engine's note (src/data/consents.ts). */
const MAX_NOTE = 300;
/** The methods a person picks: «importado» is only for the importer. */
const PERSON_METHODS = CONSENT_METHODS.filter((method) => method !== "imported");

type DialogShellProps = {
  trigger: ReactNode;
  title: string;
  description: ReactNode;
  submitLabel: string;
  pendingLabel: string;
  run: (form: FormData) => Promise<ActionResult>;
  children: (failure: ActionFailure | null) => ReactNode;
};

function ConsentDialog({ trigger, title, description, submitLabel, pendingLabel, run, children }: DialogShellProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await run(form);
      if (!result.ok) {
        setFailure(result);
        return;
      }
      toast.success(result.message ?? "Hecho.");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (next) setFailure(null);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {children(failure)}
          <FormMessage result={failure ?? undefined} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending} aria-busy={pending}>
              {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
              {pending ? pendingLabel : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MethodField({ label, failure }: { label: string; failure: ActionFailure | null }) {
  const id = useId();
  const [method, setMethod] = useState<ConsentMethod | "">("");
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <input type="hidden" name="method" value={method} />
      <Select value={method} onValueChange={(value) => setMethod(value as ConsentMethod)}>
        <SelectTrigger id={id} aria-invalid={Boolean(failure?.fieldErrors?.method)} aria-describedby={failure?.fieldErrors?.method ? `${id}-error` : undefined}>
          <SelectValue placeholder="Elige cómo" />
        </SelectTrigger>
        <SelectContent>
          {PERSON_METHODS.map((value) => (
            <SelectItem key={value} value={value}>
              {CONSENT_METHOD_LABELS[value]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldError id={`${id}-error`} errors={failure?.fieldErrors?.method?.map((message) => ({ message }))} />
    </div>
  );
}

function NoteField({ label, placeholder, failure }: { label: string; placeholder: string; failure: ActionFailure | null }) {
  const id = useId();
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea id={id} name="note" maxLength={MAX_NOTE} rows={2} placeholder={placeholder} aria-invalid={Boolean(failure?.fieldErrors?.note)} />
    </div>
  );
}

const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
const optional = (value: string) => (value ? value : undefined);

/** «Marcar» or «Quitar» one permission ([CTO-09]). */
export function PermissionButton({ contactId, permission, granted }: { contactId: string; permission: ContactPermission; granted: boolean }) {
  const dateId = useId();
  const label = PERMISSION_LABELS[permission];
  return (
    <ConsentDialog
      trigger={
        <Button type="button" variant="outline" size="sm">
          {granted ? <Check aria-hidden /> : <X aria-hidden />}
          {granted ? "Marcar" : "Quitar"}
          <span className="sr-only"> el permiso «{label}»</span>
        </Button>
      }
      title={granted ? `Marcar «${label}»` : `Quitar «${label}»`}
      description={
        granted
          ? "Márcalo solo si el cliente lo ha dado: queda anotado quién lo marca, cuándo y cómo lo dio. No quita ninguna baja."
          : "El cliente ha retirado este permiso: queda anotado quién lo quita, cuándo y cómo lo pidió."
      }
      submitLabel={granted ? "Marcar permiso" : "Quitar permiso"}
      pendingLabel="Guardando…"
      run={(form) =>
        setPermissionAction({
          contactId,
          permission,
          granted,
          method: text(form, "method"),
          givenOn: granted ? optional(text(form, "givenOn")) : undefined,
          note: optional(text(form, "note")),
        })
      }
    >
      {(failure) => (
        <>
          <MethodField label={granted ? "Cómo lo dio" : "Cómo lo pidió"} failure={failure} />
          {granted ? (
            <div className="grid gap-2">
              <Label htmlFor={dateId}>Cuándo lo dio (opcional; si no, hoy)</Label>
              <Input
                id={dateId}
                name="givenOn"
                type="date"
                aria-invalid={Boolean(failure?.fieldErrors?.givenOn)}
                aria-describedby={failure?.fieldErrors?.givenOn ? `${dateId}-error` : undefined}
              />
              <FieldError id={`${dateId}-error`} errors={failure?.fieldErrors?.givenOn?.map((message) => ({ message }))} />
            </div>
          ) : null}
          <NoteField label="Nota (opcional)" placeholder="Por ejemplo: firmó el formulario en recepción" failure={failure} />
        </>
      )}
    </ConsentDialog>
  );
}

/** «Dar de baja» when the customer asks by another way ([CTO-10]): one kind of channel or all, everything or publicidad. */
export function OptOutRequestButton({ contactId }: { contactId: string }) {
  const kindId = useId();
  const scopeId = useId();
  const [kind, setKind] = useState<ChannelKind | "all">("all");
  const [scope, setScope] = useState<OptOutScope>("all");
  return (
    <ConsentDialog
      trigger={
        <Button type="button" variant="outline" size="sm">
          <BellOff aria-hidden />
          Dar de baja
        </Button>
      }
      title="Dar de baja"
      description="Cuando el cliente pide por otra vía (por teléfono, en persona…) que no le escribáis más, o que no le mandéis novedades ni publicidad. Solo se quita si el cliente lo pide."
      submitLabel="Dar de baja"
      pendingLabel="Guardando…"
      run={(form) => recordOptOutAction({ contactId, kind, scope, method: text(form, "method"), note: optional(text(form, "note")) })}
    >
      {(failure) => (
        <>
          <div className="grid gap-2">
            <Label htmlFor={scopeId}>De qué</Label>
            <Select value={scope} onValueChange={(value) => setScope(value as OptOutScope)}>
              <SelectTrigger id={scopeId}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">De todo: la IA, los recordatorios, las plantillas y los envíos</SelectItem>
                <SelectItem value="marketing">Solo de novedades y publicidad</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={kindId}>En qué canal</Label>
            <Select value={kind} onValueChange={(value) => setKind(value as ChannelKind | "all")}>
              <SelectTrigger id={kindId}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">En todos</SelectItem>
                {(["whatsapp", "telegram", "instagram", "email", "webchat"] as const).map((value) => (
                  <SelectItem key={value} value={value}>
                    {CHANNEL_KIND_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <MethodField label="Cómo lo pidió" failure={failure} />
          <NoteField label="Nota (opcional)" placeholder="Por ejemplo: lo ha pedido por teléfono" failure={failure} />
        </>
      )}
    </ConsentDialog>
  );
}

/** «Levantar baja» of one kind and scope ([CTO-08]): only when the customer asks for it. */
export function LiftOptOutButton({ contactId, kind, scope }: { contactId: string; kind: ChannelKind; scope: OptOutScope }) {
  const what = scope === "all" ? `de ${CHANNEL_KIND_LABELS[kind]}` : `de novedades y publicidad por ${CHANNEL_KIND_LABELS[kind]}`;
  return (
    <ConsentDialog
      trigger={
        <Button type="button" variant="outline" size="sm">
          <BellRing aria-hidden />
          Levantar baja<span className="sr-only"> {what}</span>
        </Button>
      }
      title={`¿Levantar la baja ${what}?`}
      description={
        scope === "all"
          ? "Hazlo solo si el cliente te lo ha pedido: queda anotado quién la quita y cuándo. Desde ese momento la IA le responde y puede recibir recordatorios, plantillas y envíos por este canal."
          : "Hazlo solo si el cliente te lo ha pedido: queda anotado quién la quita y cuándo. Volverá a recibir novedades y publicidad por este canal si tiene ese permiso."
      }
      submitLabel="Levantar baja"
      pendingLabel="Levantando…"
      run={(form) =>
        // [CUM-13] How the customer asked for it is kept with the alta, as with every permission and baja.
        text(form, "method")
          ? liftOptOutAction({ contactId, kind, scope, method: text(form, "method"), note: optional(text(form, "note")) })
          : Promise.resolve(fail("Di cómo lo ha pedido el cliente.", { method: ["Di cómo lo ha pedido el cliente."] }))
      }
    >
      {(failure) => (
        <>
          <MethodField label="Cómo lo ha pedido" failure={failure} />
          <NoteField label="Nota (opcional)" placeholder="Por ejemplo: llamó por teléfono para volver a recibirlos" failure={failure} />
        </>
      )}
    </ConsentDialog>
  );
}
