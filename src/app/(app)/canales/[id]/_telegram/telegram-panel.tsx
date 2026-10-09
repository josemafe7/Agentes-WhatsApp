import { Info, TriangleAlert, Unplug } from "lucide-react";
import Link from "next/link";
import { CopyButton } from "@/components/copy-button";
import { QrCode } from "@/components/qr-code";
import { StatusLight } from "@/components/status-light";
import { Button } from "@/components/ui/button";
import type { ChannelDetail } from "@/data/channels";
import { getTelegramPanel } from "@/data/telegram";
import type { Actor } from "@/lib/permissions";
import { qrCodeDataUrl } from "@/server/qr";
import { telegramWizardHref } from "../../nuevo/telegram/_lib/steps";
import { PanelAlert } from "../_email/panel-alert";
import { telegramLights, telegramReviewNote, type TelegramHealthMode } from "./_lib/view";
import { TelegramPanelActions } from "./telegram-panel-actions";

type TelegramPanelProps = { actor: Actor; channel: ChannelDetail; canManage: boolean; timezone: string };

/**
 * The Telegram part of a bot's panel (docs/pantallas.md «Panel del canal», [TG-04], [TG-07], [TG-08]). Owner and admin
 * act; Solo lectura only looks and never sees the token, not even masked ([PER-03], [PER-07]). Each action checks the
 * permission again on the server ([SEG-04]).
 */
export async function TelegramPanel({ actor, channel, canManage, timezone }: TelegramPanelProps) {
  const panel = await getTelegramPanel(actor, channel.id);
  const now = new Date();
  const mode: TelegramHealthMode = channel.isDemo ? "demo" : panel.hasCredentials ? "telegram" : "disconnected";
  const lights = telegramLights(panel.lastHealth, { lastInboundAt: channel.lastInboundAt, timezone, now, mode });
  const connected = mode === "telegram";
  const botQr = panel.bot && connected ? await qrCodeDataUrl(panel.bot.link) : null;

  return (
    <>
      {mode === "demo" ? (
        <PanelAlert tone="info" icon={Info} title="Canal de demostración">
          <p>No se conecta a Telegram: los semáforos y las acciones con Telegram no se aplican. Sus mensajes se prueban con el simulador de Diagnóstico.</p>
        </PanelAlert>
      ) : null}
      {mode === "disconnected" ? (
        <PanelAlert tone="warning" icon={Unplug} title="Este bot está desconectado">
          <p>Se borró su token: no recibe ni envía mensajes. Sus conversaciones se conservan. Para volver a usarlo, conéctalo de nuevo.</p>
          {canManage ? (
            <div>
              <Button asChild variant="outline" size="sm">
                <Link href={telegramWizardHref(panel.id)}>Volver a conectar este bot</Link>
              </Button>
            </div>
          ) : null}
        </PanelAlert>
      ) : null}
      {connected && panel.receiveMode === "polling" ? (
        <PanelAlert tone="info" icon={TriangleAlert} title="Modo local">
          <p>
            Esta instalación no tiene una dirección pública, así que pregunta ella a Telegram por los mensajes nuevos cada pocos segundos. Cuando la publiques, pulsa
            «Revalidar» y Telegram le avisará al momento.
          </p>
        </PanelAlert>
      ) : null}

      <section aria-labelledby="telegram-health" className="grid gap-4 rounded-xl border p-4">
        <div className="grid gap-3">
          <div className="grid gap-1">
            <h2 id="telegram-health" className="text-base font-semibold">
              Bot de Telegram
            </h2>
            <p className="text-sm">{panel.bot ? `${panel.bot.name ?? "Sin nombre"} · @${panel.bot.username}` : "Sin bot conectado"}</p>
            {panel.maskedToken ? <p className="font-mono text-xs break-all text-muted-foreground">Token {panel.maskedToken}</p> : null}
          </div>
          {canManage && connected ? <TelegramPanelActions channelId={panel.id} channelName={panel.name} /> : null}
        </div>
        <div className="grid gap-3">
          {lights.map((light) => (
            <StatusLight key={light.key} status={light.status} label={light.label} detail={light.detail} />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{telegramReviewNote({ mode, lastHealthAt: panel.lastHealthAt, timezone })}</p>
      </section>

      {panel.bot && botQr ? (
        <section aria-labelledby="telegram-link" className="grid gap-4 rounded-xl border p-4">
          <div className="grid gap-1">
            <h2 id="telegram-link" className="text-base font-semibold">
              Enlace para tus clientes
            </h2>
            <p className="text-sm text-muted-foreground">
              Un bot no puede escribir primero: es el cliente quien abre el chat. Dale este enlace o este código (en tu web, en redes, impreso en el mostrador…).
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-center">
            <QrCode dataUrl={botQr} alt={`Código QR para abrir el chat con @${panel.bot.username} en Telegram`} />
            <div className="flex flex-wrap items-center gap-2">
              <a href={panel.bot.link} target="_blank" rel="noopener noreferrer" className="font-mono text-sm break-all text-primary-text underline-offset-4 hover:underline">
                {panel.bot.link}
                <span className="sr-only"> (se abre en una pestaña nueva)</span>
              </a>
              <CopyButton value={panel.bot.link} />
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}
