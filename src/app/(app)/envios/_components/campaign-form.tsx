"use client";
// «Programar envío» and «Cambiar» ([ENV-02]–[ENV-04], [ENV-07], [ENV-10]): a name for the team, the channels (always
// tried in their order) with the message of each one, and when it goes out; «Revisar» says how many would get it by
// each channel and why the others not, the cost by WhatsApp and when it would end. It is scheduled after that check,
// and a change to the form asks for it again.
import { LoaderCircle, SearchCheck, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { CampaignOptions, CampaignPreview } from "@/data/campaigns";
import type { ActionResult } from "@/lib/action-result";
import { CAMPAIGN_ROUTE_NAMES, CAMPAIGN_ROUTES } from "@/lib/campaigns";
import { formatCurrencyUSD, formatDateTime, formatNumber } from "@/lib/format";
import { previewCampaignAction, scheduleCampaignAction, updateCampaignAction } from "../actions";
import { campaignInput, previewInput, type CampaignFormState } from "../_lib/campaign-form";
import { campaignPath, type CampaignAudience } from "../_lib/view";
import { CampaignMessageFields } from "./campaign-message-fields";

type CampaignFormProps = {
  options: CampaignOptions;
  initial: CampaignFormState;
  /** A new envío goes to these contacts; one being changed keeps its own. */
  target: { audience: CampaignAudience } | { campaignId: string };
};

const errorList = (messages?: string[]) => messages?.map((message) => ({ message }));

export function CampaignForm({ options, initial, target }: CampaignFormProps) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [preview, setPreview] = useState<CampaignPreview | null>(null);
  const [result, setResult] = useState<ActionResult<unknown>>();
  const [checking, startCheck] = useTransition();
  const [saving, startSave] = useTransition();
  const errors = result && !result.ok ? result.fieldErrors : undefined;
  const editing = "campaignId" in target;

  // Any change asks for the check again: what is scheduled is what was checked.
  const set = (patch: Partial<CampaignFormState>) => {
    setState((current) => ({ ...current, ...patch }));
    setPreview(null);
  };

  function check() {
    startCheck(async () => {
      const outcome = await previewCampaignAction(previewInput(state, "campaignId" in target ? { campaignId: target.campaignId } : target.audience));
      setResult(outcome.ok ? undefined : outcome);
      setPreview(outcome.ok && outcome.data ? outcome.data : null);
    });
  }

  function schedule() {
    startSave(async () => {
      const outcome =
        "campaignId" in target ? await updateCampaignAction(target.campaignId, campaignInput(state)) : await scheduleCampaignAction({ ...campaignInput(state), audience: target.audience });
      if (!outcome.ok) {
        setResult(outcome);
        return;
      }
      toast.success(outcome.message ?? "Envío programado.");
      const id = "campaignId" in target ? target.campaignId : (outcome.data as { id: string } | undefined)?.id;
      router.push(id ? campaignPath(id) : "/envios");
    });
  }

  const hours = `de ${options.sendHours.start} a ${options.sendHours.end}`;

  return (
    <div className="grid max-w-[640px] gap-6">
      <div className="grid gap-2">
        <Label htmlFor="envio-nombre">Nombre</Label>
        <Input
          id="envio-nombre"
          value={state.name}
          maxLength={80}
          onChange={(event) => set({ name: event.target.value })}
          aria-invalid={Boolean(errors?.name)}
          aria-describedby={`envio-nombre-ayuda${errors?.name ? " envio-nombre-error" : ""}`}
        />
        <p id="envio-nombre-ayuda" className="text-sm text-muted-foreground">
          Solo lo ve el equipo, en Envíos.
        </p>
        <FieldError id="envio-nombre-error" errors={errorList(errors?.name)} />
      </div>

      <CampaignMessageFields options={options} value={state} onChange={set} errors={errors} />

      <fieldset className="grid gap-3">
        <legend className="text-sm font-medium">Cuándo sale</legend>
        <RadioGroup value={state.when} onValueChange={(when) => set({ when: when as "now" | "later" })} className="flex flex-wrap gap-4">
          <div className="flex items-center gap-2">
            <RadioGroupItem id="envio-ahora" value="now" />
            <Label htmlFor="envio-ahora" className="font-normal">
              Ahora
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem id="envio-mas-tarde" value="later" />
            <Label htmlFor="envio-mas-tarde" className="font-normal">
              Un día y una hora
            </Label>
          </div>
        </RadioGroup>
        {state.when === "later" ? (
          <Input
            type="datetime-local"
            aria-label="Día y hora del envío"
            className="w-60"
            value={state.at}
            onChange={(event) => set({ at: event.target.value })}
            aria-invalid={Boolean(errors?.sendAt)}
          />
        ) : null}
        <p className="text-sm text-muted-foreground">
          En la zona horaria del negocio ({options.timezone}). Solo sale {hours}; lo que no cabe sigue al día siguiente.
        </p>
        <FieldError errors={errorList(errors?.sendAt ?? errors?.audience)} />
      </fieldset>

      {preview ? <PreviewSummary preview={preview} timezone={options.timezone} /> : null}

      <FormMessage result={result} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant={preview ? "outline" : "default"} onClick={check} disabled={checking || saving} aria-busy={checking}>
          {checking ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <SearchCheck aria-hidden />}
          {checking ? "Revisando…" : "Revisar destinatarios"}
        </Button>
        <Button type="button" onClick={schedule} disabled={!preview || saving || checking} aria-busy={saving} title={preview ? undefined : "Revisa antes a quién llegará"}>
          {saving ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Send aria-hidden />}
          {saving ? "Guardando…" : editing ? "Guardar cambios" : "Programar envío"}
        </Button>
      </div>
    </div>
  );
}

/** [ENV-07] How many would get it by each channel, how many not and why, the cost by WhatsApp and when it would end. */
function PreviewSummary({ preview, timezone }: { preview: CampaignPreview; timezone: string }) {
  const reaching = CAMPAIGN_ROUTES.reduce((sum, route) => sum + preview.byRoute[route], 0);
  return (
    <section aria-labelledby="envio-revision" aria-live="polite" className="grid gap-3 rounded-xl border p-4 text-sm">
      <h2 id="envio-revision" className="text-base font-semibold">
        Lo recibirán {formatNumber(reaching)} de {formatNumber(preview.total)} {preview.total === 1 ? "contacto" : "contactos"}
      </h2>
      <ul className="grid gap-1">
        {CAMPAIGN_ROUTES.filter((route) => preview.byRoute[route] > 0).map((route) => (
          <li key={route}>
            Por {CAMPAIGN_ROUTE_NAMES[route]}: <span className="font-medium tabular-nums">{formatNumber(preview.byRoute[route])}</span>
            {route === "whatsapp" && preview.whatsappByPhone > 0 ? (
              <span className="text-muted-foreground"> ({formatNumber(preview.whatsappByPhone)} solo si su teléfono tiene WhatsApp)</span>
            ) : null}
          </li>
        ))}
      </ul>
      {preview.notSent.length > 0 ? (
        <div className="grid gap-1">
          <p className="font-medium">No lo recibirán</p>
          <ul className="grid gap-1 text-muted-foreground">
            {preview.notSent.map((item) => (
              <li key={item.reason}>
                {item.label}: <span className="tabular-nums">{formatNumber(item.count)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {preview.cost ? (
        <p>
          Coste estimado por WhatsApp: <span className="font-medium tabular-nums">{formatCurrencyUSD(preview.cost.estimate)}</span>
          {preview.cost.missingMarkets.length > 0 ? (
            <span className="text-muted-foreground"> (sin contar {preview.cost.missingMarkets.join(", ")}: falta su tarifa en Ajustes › WhatsApp)</span>
          ) : null}
        </p>
      ) : null}
      {preview.estimatedEnd ? (
        <p>Hay que repartirlo para no poner en riesgo las cuentas: terminará hacia el {formatDateTime(preview.estimatedEnd, timezone)}.</p>
      ) : null}
    </section>
  );
}
