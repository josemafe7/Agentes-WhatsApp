import { Info, Unplug } from "lucide-react";
import Link from "next/link";
import { StatusLight } from "@/components/status-light";
import { Button } from "@/components/ui/button";
import type { ChannelDetail } from "@/data/channels";
import { getBusinessProfile } from "@/data/settings";
import { listWhatsAppTemplates } from "@/data/whatsapp-templates";
import { getYCloudPanel } from "@/data/ycloud";
import { formatDateTime } from "@/lib/format";
import type { Actor } from "@/lib/permissions";
import { getSectorPreset } from "@/lib/sectors";
import { YCLOUD_HEALTH_LABELS } from "@/server/channels/ycloud/health";
import { messagingLimitOf, qualityOf } from "../../nuevo/whatsapp/_lib/labels";
import { ycloudWizardHref } from "../../nuevo/whatsapp-ycloud/_lib/steps";
import { PanelAlert } from "../_email/panel-alert";
import { panelLights } from "../_lib/health-lights";
import { TemplatesSection } from "../_whatsapp/templates-section";
import { YCloudPanelActions } from "./ycloud-panel-actions";

type YCloudPanelProps = { actor: Actor; channel: ChannelDetail; canManage: boolean; timezone: string };

/**
 * The YCloud part of a WhatsApp number's panel (docs/pantallas.md «Panel del canal», [YC-09], [YC-10], [WA-54]). Owner
 * and admin act; Solo lectura only looks and never sees the key, not even masked ([PER-03], [PER-07]). Each action
 * checks the permission again on the server ([SEG-04]).
 */
export async function YCloudPanel({ actor, channel, canManage, timezone }: YCloudPanelProps) {
  const [panel, templates, business] = await Promise.all([getYCloudPanel(actor, channel.id), listWhatsAppTemplates(actor, channel.id), getBusinessProfile(actor)]);
  const connected = panel.hasCredentials;
  const lights = panelLights(YCLOUD_HEALTH_LABELS, panel.lastHealth, {
    lastInboundAt: panel.lastInboundAt,
    timezone,
    now: new Date(),
    unchecked: connected ? null : "Número desconectado: no se comprueba con YCloud.",
    notChecked: "Todavía no se ha comprobado. Se revisa cada 6 horas o al pulsar «Revalidar».",
  });
  const review = !connected
    ? "Número desconectado: no se revisa con YCloud."
    : `${panel.lastHealthAt ? `Última revisión: ${formatDateTime(panel.lastHealthAt, timezone)}.` : "Todavía no se ha revisado con YCloud."} Se revisa sola cada 6 horas; si algo empeora, se avisa al propietario y a los administradores.`;

  return (
    <>
      {connected ? null : (
        <PanelAlert tone="warning" icon={Unplug} title="Este número está desconectado">
          <p>Se borró su clave de YCloud: no recibe ni envía mensajes. Sus conversaciones se conservan. Para volver a usarlo, conéctalo de nuevo.</p>
          {canManage ? (
            <div>
              <Button asChild variant="outline" size="sm">
                <Link href={ycloudWizardHref(panel.id)}>Volver a conectar este número</Link>
              </Button>
            </div>
          ) : null}
        </PanelAlert>
      )}
      {connected && !panel.canReceive ? (
        <PanelAlert tone="info" icon={Info} title="Todavía no recibe mensajes">
          <p>
            Esta instalación no tiene una dirección pública con HTTPS, así que YCloud no puede avisarla. Cuando la publiques, pulsa «Revalidar»: la app creará sola la
            dirección de avisos en YCloud.
          </p>
        </PanelAlert>
      ) : null}

      <section aria-labelledby="ycloud-health" className="grid gap-4 rounded-xl border p-4">
        <div className="grid gap-3">
          <div className="grid gap-1">
            <h2 id="ycloud-health" className="text-base font-semibold">
              WhatsApp · YCloud (coexistencia)
            </h2>
            <p className="text-sm">
              {panel.displayPhoneNumber ?? "Sin número"}
              {panel.verifiedName ? ` · ${panel.verifiedName}` : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              API oficial de WhatsApp a través de YCloud: el número sigue funcionando en la app WhatsApp Business del móvil, y lo que escribes desde allí aparece en la
              bandeja como «Desde el móvil».
            </p>
            {panel.maskedKey ? <p className="font-mono text-xs break-all text-muted-foreground">Clave {panel.maskedKey}</p> : null}
          </div>
          {canManage && connected ? <YCloudPanelActions channelId={panel.id} channelName={panel.name} /> : null}
        </div>
        <div className="grid gap-3">
          {lights.map((light) => (
            <StatusLight key={light.key} status={light.status} label={light.label} detail={light.detail} />
          ))}
        </div>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Calidad del número</dt>
            <dd>{qualityOf(panel.qualityRating).label}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Límite de envío</dt>
            <dd>{messagingLimitOf(panel.messagingLimit)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Plantillas sincronizadas</dt>
            <dd>{panel.templates}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Dirección de avisos</dt>
            <dd className="font-mono text-xs break-all">{panel.webhookUrl}</dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">{review}</p>
      </section>
      <TemplatesSection
        channelId={panel.id}
        templates={templates}
        canSync={false}
        canCreate={canManage && connected}
        timezone={timezone}
        healthData={business.sector ? getSectorPreset(business.sector).healthData : false}
        businessName={business.name}
        provider="desde YCloud"
      />
    </>
  );
}
