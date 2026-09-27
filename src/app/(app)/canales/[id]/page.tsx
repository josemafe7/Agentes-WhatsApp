import { ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import { StatusLight, type StatusLightStatus } from "@/components/status-light";
import { Button } from "@/components/ui/button";
import { listAgents } from "@/data/agents";
import type { ChannelDetail } from "@/data/channels";
import { getBusinessProfile } from "@/data/settings";
import { formatDateTime, formatRelative } from "@/lib/format";
import { can, PERMISSIONS } from "@/lib/permissions";
import { isEmailChannelType } from "@/server/channels/email/config";
import { ActiveAgentControl } from "../_components/active-agent-control";
import { CHANNEL_STATUS_LABELS } from "../_lib/labels";
import { widgetDemoHref } from "../_lib/webchat";
import { wizardHref } from "../nuevo/whatsapp/_lib/steps";
import { ChannelDangerZone } from "./_components/channel-danger-zone";
import { EmailPanel } from "./_email/email-panel";
import { WhatsAppPanel } from "./_whatsapp/whatsapp-panel";
import { loadChannelPage } from "./_lib/load";

export const metadata: Metadata = { title: "Canal" };

type PageProps = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

type Light = { key: string; status: StatusLightStatus; label: string; detail?: string };

const STATUS_LIGHT: Record<ChannelDetail["status"], StatusLightStatus> = {
  draft: "off",
  connecting: "pending",
  connected: "ok",
  error: "error",
  disabled: "off",
};

/** The traffic lights every type shares ([CAN-01]); a web chat adds where it works ([WEB-10]). */
function summaryLights(channel: ChannelDetail, timezone: string): Light[] {
  const lights: Light[] = [
    {
      key: "status",
      status: STATUS_LIGHT[channel.status],
      label: "Estado",
      detail:
        channel.status === "disabled"
          ? "Desactivado: no responde ni envía, y conserva su historial."
          : channel.status === "error"
            ? (channel.lastHealth?.error ?? "El canal tiene un error. Revisa su configuración.")
            : CHANNEL_STATUS_LABELS[channel.status],
    },
    channel.lastInboundAt
      ? {
          key: "last",
          status: "ok",
          label: "Último mensaje recibido",
          detail: `${formatDateTime(channel.lastInboundAt, timezone)} (${formatRelative(channel.lastInboundAt, timezone)})`,
        }
      : { key: "last", status: "off", label: "Último mensaje recibido", detail: "Aún no ha llegado ninguno." },
    !channel.activeAgent
      ? { key: "agent", status: "warn", label: "Agente", detail: "Sin agente activo: la IA no responde y los mensajes esperan a una persona." }
      : !channel.aiEnabled
        ? { key: "agent", status: "warn", label: "Agente", detail: `IA apagada: «${channel.activeAgent.name}» no responde hasta que la enciendas.` }
        : { key: "agent", status: "ok", label: "Agente", detail: `Responde «${channel.activeAgent.name}».` },
  ];
  if (channel.testMode) {
    lights.push({
      key: "test",
      status: "warn",
      label: "Modo pruebas",
      detail: `La IA solo contesta a ${channel.testAllowlist.length === 1 ? "1 contacto" : `${channel.testAllowlist.length} contactos`} de la lista; el resto espera a una persona.`,
    });
  }
  if (channel.webchat) {
    const domains = channel.webchat.allowedDomains;
    lights.push(
      domains.length === 0
        ? { key: "domains", status: "warn", label: "Dónde funciona", detail: "Solo dentro de la app, en /widget-demo. Añade tu dominio en «Apariencia y código»." }
        : { key: "domains", status: "ok", label: "Dónde funciona", detail: domains.join(", ") },
    );
  }
  return lights;
}

/** Resumen del canal (docs/pantallas.md «Panel del canal»): traffic lights, agent and AI, try it, disable or delete. */
export default async function ChannelSummaryPage({ params, searchParams }: PageProps) {
  const page = await loadChannelPage(params);
  if (!page.allowed) return null;
  const { actor, channel, canManage } = page;
  const [agents, profile] = await Promise.all([
    can(actor, PERMISSIONS.agents.view) ? listAgents(actor) : Promise.resolve([]),
    getBusinessProfile(actor),
  ]);

  return (
    <div className="grid max-w-3xl gap-6">
      <section aria-labelledby="channel-health" className="grid gap-3 rounded-xl border p-4">
        <h2 id="channel-health" className="text-base font-semibold">
          Estado
        </h2>
        <div className="grid gap-3">
          {summaryLights(channel, profile.timezone).map((light) => (
            <StatusLight key={light.key} status={light.status} label={light.label} detail={light.detail} />
          ))}
        </div>
      </section>

      {channel.type === "whatsapp" ? <WhatsAppPanel actor={actor} channel={channel} canManage={canManage} timezone={profile.timezone} /> : null}
      {isEmailChannelType(channel.type) ? (
        <EmailPanel actor={actor} channel={channel} canManage={canManage} timezone={profile.timezone} businessName={profile.name} searchParams={await searchParams} />
      ) : null}

      <section aria-labelledby="channel-agent" className="grid gap-3 rounded-xl border p-4">
        <div className="grid gap-1">
          <h2 id="channel-agent" className="text-base font-semibold">
            Agente e IA
          </h2>
          <p className="text-sm text-muted-foreground">Un solo agente activo por canal. El cambio vale para los mensajes que lleguen después.</p>
        </div>
        <ActiveAgentControl
          channelId={channel.id}
          channelName={channel.name}
          agents={agents.map(({ id, name }) => ({ id, name }))}
          activeAgent={channel.activeAgent}
          aiEnabled={channel.aiEnabled}
          canManage={canManage}
          className="max-w-sm"
        />
      </section>

      {channel.type === "webchat" ? (
        <section aria-labelledby="channel-try" className="grid gap-3 rounded-xl border p-4">
          <div className="grid gap-1">
            <h2 id="channel-try" className="text-base font-semibold">
              Probar
            </h2>
            <p className="text-sm text-muted-foreground">Ábrelo en la página de prueba y escribe como si fueras un cliente: la conversación aparece en la bandeja.</p>
          </div>
          <div>
            <Button asChild variant="outline">
              <a href={widgetDemoHref(channel.id)} target="_blank" rel="noopener">
                <ExternalLink aria-hidden />
                Abrir en /widget-demo
              </a>
            </Button>
          </div>
        </section>
      ) : null}

      {canManage ? (
        <ChannelDangerZone
          channelId={channel.id}
          channelName={channel.name}
          enabled={channel.status !== "disabled"}
          reconnectHref={channel.type === "whatsapp" && !channel.isDemo && !channel.hasSecrets ? wizardHref(channel.id) : null}
        />
      ) : null}
    </div>
  );
}
