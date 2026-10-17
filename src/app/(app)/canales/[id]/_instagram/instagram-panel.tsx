import { ExternalLink, Info, Unplug } from "lucide-react";
import Link from "next/link";
import { StatusLight } from "@/components/status-light";
import { Button } from "@/components/ui/button";
import type { ChannelDetail } from "@/data/channels";
import { getInstagramPanel } from "@/data/instagram";
import type { Actor } from "@/lib/permissions";
import { CopyField } from "../../nuevo/whatsapp/_components/copy-field";
import { instagramHandle, instagramWizardHref } from "../../nuevo/instagram/_lib/steps";
import { PanelAlert } from "../_email/panel-alert";
import { instagramLights, instagramReviewNote, tokenValidity, type InstagramHealthMode } from "./_lib/view";
import { InstagramPanelActions } from "./instagram-panel-actions";

type InstagramPanelProps = { actor: Actor; channel: ChannelDetail; canManage: boolean; timezone: string };

/**
 * The Instagram part of an account's panel (docs/pantallas.md «Panel del canal», [IG-09], [IG-10]). Owner and admin act
 * and see the token masked and the webhook's verify token; Solo lectura only looks and never sees either ([PER-03],
 * [PER-07]). Each action checks the permission again on the server ([SEG-04]). A demo channel only explains itself.
 */
export async function InstagramPanel({ actor, channel, canManage, timezone }: InstagramPanelProps) {
  const panel = await getInstagramPanel(actor, channel.id);
  const now = new Date();
  const mode: InstagramHealthMode = channel.isDemo ? "demo" : panel.hasCredentials ? "instagram" : "disconnected";
  const lights = instagramLights(panel.lastHealth, { lastInboundAt: channel.lastInboundAt, timezone, now, mode });
  const connected = mode === "instagram";
  const validity = connected && panel.tokenExpiresAt ? tokenValidity(panel.tokenExpiresAt, { timezone, now }) : null;

  return (
    <>
      {mode === "demo" ? (
        <PanelAlert tone="info" icon={Info} title="Canal de demostración">
          <p>
            No se conecta a Instagram: los semáforos y las acciones con Instagram no se aplican, y lo que «envía» solo se guarda en la app. Sus mensajes se prueban con el
            simulador de Diagnóstico.
          </p>
        </PanelAlert>
      ) : null}
      {mode === "disconnected" ? (
        <PanelAlert tone="warning" icon={Unplug} title="Esta cuenta está desconectada">
          <p>Se borraron su token y sus claves: no recibe ni envía mensajes. Sus conversaciones se conservan. Para volver a usarla, conéctala de nuevo.</p>
          {canManage ? (
            <div>
              <Button asChild variant="outline" size="sm">
                <Link href={instagramWizardHref(panel.id)}>Volver a conectar esta cuenta</Link>
              </Button>
            </div>
          ) : null}
        </PanelAlert>
      ) : null}

      <section aria-labelledby="instagram-health" className="grid gap-4 rounded-xl border p-4">
        <div className="grid gap-3">
          <div className="grid gap-1">
            <h2 id="instagram-health" className="text-base font-semibold">
              Cuenta de Instagram
            </h2>
            {panel.account && mode === "demo" ? (
              // A demo account is not on Instagram: no link to a profile that does not exist.
              <p className="text-sm font-medium">{instagramHandle(panel.account.username)}</p>
            ) : panel.account ? (
              <p className="flex flex-wrap items-center gap-x-2 text-sm">
                <a href={panel.account.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-primary-text underline-offset-4 hover:underline">
                  {instagramHandle(panel.account.username)}
                  <ExternalLink aria-hidden className="size-3.5" />
                  <span className="sr-only"> (se abre en una pestaña nueva)</span>
                </a>
                {panel.account.name ? <span className="text-muted-foreground">{panel.account.name}</span> : null}
              </p>
            ) : (
              <p className="text-sm">Sin cuenta conectada</p>
            )}
            {panel.maskedToken ? <p className="font-mono text-xs break-all text-muted-foreground">Token {panel.maskedToken}</p> : null}
            {validity ? <p className={validity.expired ? "text-sm text-destructive-text" : "text-sm text-muted-foreground"}>{validity.text}</p> : null}
          </div>
          {canManage && connected ? <InstagramPanelActions channelId={panel.id} channelName={panel.name} /> : null}
        </div>
        <div className="grid gap-3">
          {lights.map((light) => (
            <StatusLight key={light.key} status={light.status} label={light.label} detail={light.detail} />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{instagramReviewNote({ mode, lastHealthAt: panel.lastHealthAt, timezone })}</p>
      </section>

      {connected && panel.verifyToken ? (
        <section aria-labelledby="instagram-webhook" className="grid gap-4 rounded-xl border p-4">
          <div className="grid gap-1">
            <h2 id="instagram-webhook" className="text-base font-semibold">
              Avisos de Meta
            </h2>
            <p className="text-sm text-muted-foreground">
              En tu app de Meta, en Instagram › API setup with Instagram login › Configure webhooks, van esta dirección y este token de verificación, con el campo «messages»
              suscrito.
            </p>
          </div>
          <CopyField label="URL de devolución de llamada (Callback URL)" value={panel.webhookUrl} />
          <CopyField label="Token de verificación (Verify token)" value={panel.verifyToken} />
          {panel.publicUrl ? null : (
            <p className="text-sm text-muted-foreground">Esta instalación no tiene una dirección pública con HTTPS: Meta no podrá avisarla hasta que esté publicada en su dominio.</p>
          )}
        </section>
      ) : null}
    </>
  );
}
