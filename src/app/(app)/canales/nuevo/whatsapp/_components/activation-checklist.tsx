"use client";

import { ExternalLink, FileText } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { FormMessage } from "@/components/form-message";
import { HelpLink } from "@/components/help-link";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import type { ActionResult } from "@/lib/action-result";
import { formatNumber } from "@/lib/format";
import { saveChecklistAction, syncTemplatesAction } from "../actions";
import { guideHref, META_BILLING_HUB_URL } from "../_lib/help";
import { CopyField } from "./copy-field";
import { BusyButton } from "./wizard-footer";

export type LegalUrls = { terms: string; privacy: string; deletion: string };

type CheckProps = {
  channelId: string;
  checked: boolean;
  onChecked: (checked: boolean) => void;
  field: "appLiveConfirmed" | "paymentMethodConfirmed";
  label: string;
  description: string;
};

/** A check the person ticks by hand, saved at once: there is no API to read it ([WA-21]). */
function ManualCheck({ channelId, checked, onChecked, field, label, description }: CheckProps) {
  const id = useId();
  const [pending, startTransition] = useTransition();

  function change(next: boolean) {
    onChecked(next);
    startTransition(async () => {
      const result = await saveChecklistAction(channelId, { [field]: next });
      if (!result.ok) {
        onChecked(!next);
        toast.error(result.error);
      }
    });
  }

  return (
    <Field orientation="horizontal">
      <Checkbox id={id} checked={checked} disabled={pending} onCheckedChange={(value) => change(value === true)} aria-describedby={`${id}-help`} />
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <FieldDescription id={`${id}-help`}>{description}</FieldDescription>
      </FieldContent>
    </Field>
  );
}

type LiveChecklistProps = { channelId: string; initialChecked: boolean; legalUrls: LegalUrls };

/** «App publicada (Live)» ([WA-21], docs/integracion-whatsapp.md §5.6): what Meta asks and our three legal pages. */
export function LiveChecklist({ channelId, initialChecked, legalUrls }: LiveChecklistProps) {
  const [checked, setChecked] = useState(initialChecked);
  return (
    <section aria-labelledby="wa-live" className="grid gap-4 rounded-xl border bg-card p-4 sm:p-6">
      <div className="grid gap-1">
        <h3 id="wa-live" className="font-semibold">
          App publicada (Live)
        </h3>
        <p className="text-sm text-muted-foreground">
          Mientras la app de Meta esté en desarrollo no llegan los mensajes reales. Para publicarla no hace falta revisión de Meta ni verificar la
          empresa: en el panel de la app, ve a <span className="font-medium text-foreground">Publicar</span> y pulsa «Go live». Antes, Meta pide en
          Configuración de la app › Básica:
        </p>
      </div>
      <ul className="grid list-disc gap-1 pl-5 text-sm text-muted-foreground">
        <li>Nombre visible, sin «WhatsApp», «Facebook», «FB» ni otros productos de Meta.</li>
        <li>Email de contacto (le llegan los avisos para desarrolladores).</li>
        <li>URL de las condiciones del servicio (abajo).</li>
        <li>Icono, sin logotipos de Meta ni de WhatsApp.</li>
        <li>Categoría y propósito de la app.</li>
        <li>Conviene rellenar también la política de privacidad y la eliminación de datos (abajo).</li>
      </ul>
      <div className="grid gap-3">
        <CopyField label="Condiciones del servicio" value={legalUrls.terms} />
        <CopyField label="Política de privacidad" value={legalUrls.privacy} />
        <CopyField label="Eliminación de datos" value={legalUrls.deletion} />
      </div>
      <ManualCheck
        channelId={channelId}
        checked={checked}
        onChecked={setChecked}
        field="appLiveConfirmed"
        label="App publicada (Live) en el panel de Meta"
        description="Márcalo cuando la veas publicada en el panel de la app: la API no permite comprobarlo."
      />
      <HelpLink href={guideHref("publicar-app")}>Cómo publicar la app, paso a paso</HelpLink>
    </section>
  );
}

type PaymentChecklistProps = { channelId: string; checked: boolean; onChecked: (checked: boolean) => void };

/**
 * «Método de pago en WhatsApp Manager» ([WA-21], docs §5.7): the API cannot check it, so the wizard does not finish
 * until the person confirms it by hand. Not asked for Meta's test number.
 */
export function PaymentChecklist({ channelId, checked, onChecked }: PaymentChecklistProps) {
  return (
    <section aria-labelledby="wa-payment" className="grid gap-4 rounded-xl border bg-card p-4 sm:p-6">
      <div className="grid gap-1">
        <h3 id="wa-payment" className="font-semibold">
          Método de pago en WhatsApp Manager
        </h3>
        <p className="text-sm text-muted-foreground">
          Desde el 1-10-2026, sin método de pago Meta deja de entregar los mensajes de servicio cuando se acaban los 1.000 gratis del mes de cada
          número. La API no permite comprobarlo: si Meta rechaza envíos con el error 131042, es que falta. Se añade en el Centro de facturación
          (Billing Hub) de Meta, en Métodos de pago.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button asChild variant="outline">
          <a href={META_BILLING_HUB_URL} target="_blank" rel="noopener noreferrer">
            <ExternalLink aria-hidden />
            Abrir el Centro de facturación de Meta
            <span className="sr-only"> (se abre en una pestaña nueva)</span>
          </a>
        </Button>
        <HelpLink href={guideHref("metodo-de-pago")}>Ver la guía</HelpLink>
      </div>
      <ManualCheck
        channelId={channelId}
        checked={checked}
        onChecked={onChecked}
        field="paymentMethodConfirmed"
        label="He añadido el método de pago de la cuenta de WhatsApp"
        description="Hace falta para terminar la activación."
      />
    </section>
  );
}

/** «Sincronizar plantillas» ([WA-22]): the number's templates with their status, category, language and variables. */
export function TemplatesSync({ channelId, initialCount }: { channelId: string; initialCount: number }) {
  const [result, setResult] = useState<ActionResult | undefined>(undefined);
  const [count, setCount] = useState(initialCount);
  const [pending, startTransition] = useTransition();

  function sync() {
    startTransition(async () => {
      const outcome = await syncTemplatesAction(channelId);
      if (!outcome.ok) return setResult(outcome);
      const total = outcome.data?.total ?? 0;
      setCount(total);
      setResult({ ok: true, message: `${formatNumber(total)} plantillas sincronizadas, ${formatNumber(outcome.data?.approved ?? 0)} aprobadas.` });
    });
  }

  return (
    <section aria-labelledby="wa-templates" className="grid gap-4 rounded-xl border bg-card p-4 sm:p-6">
      <div className="grid gap-1">
        <h3 id="wa-templates" className="flex items-center gap-2 font-semibold">
          <FileText aria-hidden className="size-4 text-muted-foreground" />
          Plantillas
        </h3>
        <p className="text-sm text-muted-foreground">
          Pasadas 24 horas desde el último mensaje del cliente, solo se le puede escribir con una plantilla aprobada por Meta. Tráelas ahora; después
          se actualizan solas cuando Meta cambia su estado. {count > 0 ? `Ahora hay ${formatNumber(count)}.` : "Aún no hay ninguna sincronizada."}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <BusyButton variant="outline" pending={pending} pendingLabel="Sincronizando…" onClick={sync}>
          Sincronizar plantillas
        </BusyButton>
        <HelpLink href={guideHref("plantillas")}>Cómo crear plantillas</HelpLink>
      </div>
      <FormMessage result={result} />
    </section>
  );
}
