import { OctagonAlert, TriangleAlert, Unplug } from "lucide-react";
import Link from "next/link";
import { HelpLink } from "@/components/help-link";
import { StatusLight } from "@/components/status-light";
import { Button } from "@/components/ui/button";
import type { ChannelDetail } from "@/data/channels";
import { getWhatsAppQrPanel } from "@/data/whatsapp-qr";
import { formatDateTime } from "@/lib/format";
import type { Actor } from "@/lib/permissions";
import { WHATSAPP_QR_HEALTH_LABELS } from "@/server/channels/whatsapp-qr/health";
import { qrWizardHref, WHATSAPP_QR_GUIDE_HREF } from "../../nuevo/whatsapp-qr/_lib/steps";
import { PanelAlert } from "../_email/panel-alert";
import { panelLights } from "../_lib/health-lights";
import { WhatsAppQrPanelActions } from "./whatsapp-qr-panel-actions";

type WhatsAppQrPanelProps = { actor: Actor; channel: ChannelDetail; canManage: boolean; timezone: string };

/** Sessions that are gone or were never finished: only a new code brings the number back. */
const NEEDS_LINK = new Set(["logged_out", "refused", "expired"]);
/** Sessions that are working, or on their way. */
const ALIVE = new Set(["open", "starting", "reconnecting", "pairing"]);

/**
 * The QR code part of a WhatsApp number's panel (docs/pantallas.md «Panel del canal», [QR-10]–[QR-12], [WA-54]). It
 * always says that this way is not official. Owner and admin act; Solo lectura only looks. Each action checks the
 * permission again on the server ([SEG-04]).
 */
export async function WhatsAppQrPanel({ actor, channel, canManage, timezone }: WhatsAppQrPanelProps) {
  const panel = await getWhatsAppQrPanel(actor, channel.id);
  const disabled = panel.status === "disabled";
  const needsLink = !panel.hasSession || NEEDS_LINK.has(panel.session);
  const lights = panelLights(WHATSAPP_QR_HEALTH_LABELS, panel.health, {
    lastInboundAt: panel.lastInboundAt,
    timezone,
    now: new Date(),
    unchecked: !panel.hasSession ? "Número sin vincular: no hay sesión que comprobar." : disabled ? "Canal desactivado: la conexión está cerrada." : null,
    notChecked: "Todavía no se ha comprobado.",
  });

  return (
    <>
      {panel.unsupported ? (
        <PanelAlert tone="error" icon={OctagonAlert} title="Aquí no puede funcionar">
          <p>{panel.unsupported}</p>
        </PanelAlert>
      ) : null}
      {needsLink && !panel.unsupported ? (
        <PanelAlert tone="warning" icon={Unplug} title={panel.displayPhoneNumber ? "Este número ya no está vinculado" : "Este número todavía no está vinculado"}>
          <p>
            {panel.displayPhoneNumber
              ? "La sesión se cerró (desde el móvil, o la retiró WhatsApp): no recibe ni envía mensajes. Sus conversaciones se conservan. Para volver a usarlo, escanea un código nuevo con ese mismo móvil."
              : "Nadie llegó a escanear el código. Genera uno nuevo y escanéalo desde WhatsApp › Dispositivos vinculados."}
          </p>
          {canManage ? (
            <div>
              <Button asChild variant="outline" size="sm">
                <Link href={qrWizardHref(panel.id)}>Volver a vincular</Link>
              </Button>
            </div>
          ) : null}
        </PanelAlert>
      ) : null}

      <section aria-labelledby="whatsapp-qr-health" className="grid gap-4 rounded-xl border p-4">
        <div className="grid gap-3">
          <div className="grid gap-1">
            <h2 id="whatsapp-qr-health" className="text-base font-semibold">
              WhatsApp · Código QR (no oficial)
            </h2>
            <p className="text-sm">
              {panel.displayPhoneNumber ?? "Sin número"}
              {panel.accountName ? ` · ${panel.accountName}` : ""}
            </p>
            {panel.linkedAt ? <p className="text-xs text-muted-foreground">Vinculado el {formatDateTime(new Date(panel.linkedAt), timezone)}. Lo anterior a ese momento no se lee.</p> : null}
          </div>
          {canManage ? <WhatsAppQrPanelActions channelId={panel.id} channelName={panel.name} canReconnect={panel.hasSession && !disabled && !panel.unsupported && !ALIVE.has(panel.session)} /> : null}
        </div>
        <div className="grid gap-3">
          {lights.map((light) => (
            <StatusLight key={light.key} status={light.status} label={light.label} detail={light.detail} />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Los semáforos dicen cómo está la conexión ahora mismo. Si el móvil cierra la sesión o WhatsApp la retira, se avisa al propietario y a los administradores.
        </p>
      </section>

      <PanelAlert tone="warning" icon={TriangleAlert} title="Esta vía no es la API oficial de WhatsApp">
        <p>
          El número está vinculado como un dispositivo más, igual que WhatsApp Web, con una librería que no es de WhatsApp. Va contra sus condiciones y pueden bloquear
          el número. No hay plantillas ni ventana de 24 horas, y solo se leen los chats individuales (ni grupos, ni estados, ni canales).
        </p>
        <div>
          <HelpLink href={`${WHATSAPP_QR_GUIDE_HREF}#riesgos`}>Los riesgos, explicados</HelpLink>
        </div>
      </PanelAlert>
    </>
  );
}
