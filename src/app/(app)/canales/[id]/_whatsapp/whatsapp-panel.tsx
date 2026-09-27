import { CircleX, CreditCard, ExternalLink, FlaskConical, Info, TriangleAlert, Unplug, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { StatusLight } from "@/components/status-light";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { ChannelDetail } from "@/data/channels";
import { listWhatsAppAccountNotices } from "@/data/whatsapp-account-alerts";
import { getWhatsAppPanel, type WhatsAppPanel as PanelData } from "@/data/whatsapp-panel";
import { listWhatsAppTemplates } from "@/data/whatsapp-templates";
import { formatDateTime } from "@/lib/format";
import { DEFAULT_GRAPH_API_VERSION } from "@/lib/meta/versions";
import type { Actor } from "@/lib/permissions";
import { MetaLimits } from "../../nuevo/whatsapp/_components/meta-limits";
import { META_BILLING_HUB_URL } from "../../nuevo/whatsapp/_lib/help";
import { wizardHref } from "../../nuevo/whatsapp/_lib/steps";
import { healthLights, healthReviewNote, type HealthMode, TEST_ALLOWLIST_HELP } from "./_lib/view";
import { ApiVersionForm } from "./api-version-form";
import { ChangeSecretDialog } from "./change-secret-dialog";
import { NoticesSection } from "./notices-section";
import { PanelActions } from "./panel-actions";
import { ReregisterButton } from "./reregister-button";
import { SettingsSwitches } from "./settings-switches";
import { TemplatesSection } from "./templates-section";
import { TestModeForm } from "./test-mode-form";

type WhatsAppPanelProps = { actor: Actor; channel: ChannelDetail; canManage: boolean; timezone: string };

type Tone = "info" | "warning" | "error";

const TONES: Record<Tone, { className: string; text: string }> = {
  info: { className: "border-info/30 bg-info-soft text-info", text: "text-info" },
  warning: { className: "border-warning/30 bg-warning-soft text-warning", text: "text-warning" },
  error: { className: "border-destructive/30 bg-destructive-soft text-destructive-text", text: "text-destructive-text" },
};

function PanelAlert({ tone, icon: Icon, title, children }: { tone: Tone; icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <Alert className={TONES[tone].className}>
      <Icon aria-hidden />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className={`grid gap-2 ${TONES[tone].text}`}>{children}</AlertDescription>
    </Alert>
  );
}

/** What needs attention first: demo, Meta's test number, disconnected, payment, re-registration and token expiry. */
function PanelAlerts({ panel, isDemo, canManage, timezone, now }: { panel: PanelData; isDemo: boolean; canManage: boolean; timezone: string; now: Date }) {
  const metaActions = canManage && !isDemo && panel.hasCredentials;
  const alerts: ReactNode[] = [];
  if (isDemo) {
    alerts.push(
      <PanelAlert key="demo" tone="info" icon={Info} title="Canal de demostración">
        <p>No se conecta a Meta: los semáforos, las plantillas y las acciones con Meta no se aplican. Sus mensajes se prueban con el simulador de Diagnóstico.</p>
      </PanelAlert>,
    );
  }
  if (panel.isMetaTestNumber) {
    alerts.push(
      <PanelAlert key="test-number" tone="info" icon={FlaskConical} title="Número de prueba de Meta">
        <p>Solo reciben mensajes los destinatarios verificados que añadas en API Setup (campo «To») de tu app de Meta.</p>
      </PanelAlert>,
    );
  }
  if (!isDemo && !panel.hasCredentials) {
    alerts.push(
      <PanelAlert key="disconnected" tone="warning" icon={Unplug} title="Este número está desconectado">
        <p>Se borraron sus credenciales: no recibe ni envía mensajes. Sus conversaciones se conservan. Para volver a usarlo, conéctalo de nuevo.</p>
        {canManage ? (
          <div>
            <Button asChild variant="outline" size="sm">
              <Link href={wizardHref(panel.id)}>Volver a conectar este número</Link>
            </Button>
          </div>
        ) : null}
      </PanelAlert>,
    );
  } else if (!isDemo && panel.status === "connecting") {
    // Left halfway through the wizard: it resumes at the step where it stopped (DESIGN.md › Asistentes).
    alerts.push(
      <PanelAlert key="connecting" tone="warning" icon={TriangleAlert} title="Falta terminar de conectar este número">
        <p>Hasta que la app quede suscrita a su cuenta de WhatsApp y el número esté registrado, no llegan mensajes.</p>
        {canManage ? (
          <div>
            <Button asChild variant="outline" size="sm">
              <Link href={wizardHref(panel.id)}>Continuar configuración</Link>
            </Button>
          </div>
        ) : null}
      </PanelAlert>,
    );
  }
  if (panel.paymentAlert) {
    alerts.push(
      <PanelAlert key="payment" tone="error" icon={CreditCard} title="Puede que falte el método de pago en Meta">
        <p>
          Meta ha rechazado envíos por el método de pago, o fallan mensajes de servicio después de los 1.000 gratis del mes. Sin método de pago, Meta deja
          de entregar esos mensajes.
        </p>
        <p>
          <a href={META_BILLING_HUB_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium underline underline-offset-4">
            Abrir el Centro de facturación de Meta
            <ExternalLink aria-hidden className="size-3.5" />
            <span className="sr-only"> (se abre en una pestaña nueva)</span>
          </a>
        </p>
      </PanelAlert>,
    );
  }
  if (panel.reregisterBy) {
    const late = panel.reregisterBy.getTime() < now.getTime();
    alerts.push(
      <PanelAlert key="reregister" tone={late ? "error" : "warning"} icon={late ? CircleX : TriangleAlert} title="Meta ha aprobado el nombre nuevo">
        <p>
          {late
            ? "Pasaron los 14 días sin volver a registrar el número: pide otra vez la revisión del nombre en WhatsApp Manager."
            : `Vuelve a registrar el número antes del ${formatDateTime(panel.reregisterBy, timezone, { preset: "long-date" })} para que se vea el nombre nuevo.`}
        </p>
        {metaActions && !late ? (
          <div>
            <ReregisterButton channelId={panel.id} left={panel.register.left} />
          </div>
        ) : null}
      </PanelAlert>,
    );
  }
  if (panel.tokenExpiresAt) {
    alerts.push(
      <PanelAlert key="token" tone="warning" icon={TriangleAlert} title={`El token caduca el ${formatDateTime(panel.tokenExpiresAt, timezone, { preset: "long-date" })}`}>
        <p>Cuando caduque, el número dejará de funcionar. Crea un token permanente del usuario del sistema y pulsa «Cambiar token».</p>
      </PanelAlert>,
    );
  }
  return alerts.length > 0 ? <div className="grid gap-3">{alerts}</div> : null;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[160px_1fr] sm:items-center sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-3 text-sm">{children}</dd>
    </div>
  );
}

/**
 * The WhatsApp part of a number's panel (docs/pantallas.md «Panel del canal», [WA-20]–[WA-22], [WA-26]–[WA-30], [WA-46],
 * [WA-48], [WA-51]). Owner and admin act; Solo lectura only looks and never sees a secret, not even masked ([PER-03],
 * [PER-07]). Each action checks the permission again on the server ([SEG-04]).
 */
export async function WhatsAppPanel({ actor, channel, canManage, timezone }: WhatsAppPanelProps) {
  const [panel, templates, notices] = await Promise.all([
    getWhatsAppPanel(actor, channel.id),
    listWhatsAppTemplates(actor, channel.id),
    listWhatsAppAccountNotices(actor, channel.id),
  ]);
  const now = new Date();
  const isDemo = channel.isDemo;
  const metaActions = canManage && !isDemo && panel.hasCredentials;
  const mode: HealthMode = isDemo ? "demo" : panel.hasCredentials ? "meta" : "disconnected";
  const lights = healthLights(panel.lastHealth, { lastInboundAt: panel.lastInboundAt, messagingLimit: panel.messagingLimit, timezone, now, mode });
  const ids = [
    panel.phoneNumberId ? `Phone Number ID ${panel.phoneNumberId}` : null,
    panel.wabaId ? `WABA ${panel.wabaId}` : null,
    panel.metaAppId ? `App ${panel.metaAppId}` : null,
  ].filter(Boolean);

  return (
    <>
      <PanelAlerts panel={panel} isDemo={isDemo} canManage={canManage} timezone={timezone} now={now} />

      <section aria-labelledby="whatsapp-health" className="grid gap-4 rounded-xl border p-4">
        <div className="grid gap-3">
          <div className="grid gap-1">
            <h2 id="whatsapp-health" className="text-base font-semibold">
              Número de WhatsApp
            </h2>
            <p className="text-sm">
              {panel.verifiedName ?? "Sin nombre verificado"} · {panel.displayPhoneNumber ?? "Sin número"}
            </p>
            {ids.length > 0 ? <p className="font-mono text-xs break-all text-muted-foreground">{ids.join(" · ")}</p> : null}
          </div>
          {canManage ? (
            <PanelActions
              channelId={panel.id}
              channelName={panel.name}
              aiEnabled={channel.aiEnabled}
              metaActions={metaActions}
              canDisconnect={metaActions}
            />
          ) : null}
        </div>
        <div className="grid gap-3">
          {lights.map((light) => (
            <StatusLight key={light.key} status={light.status} label={light.label} detail={light.detail} />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{healthReviewNote({ mode, lastHealthAt: panel.lastHealthAt, timezone })}</p>
      </section>

      {metaActions && panel.secrets ? (
        <section aria-labelledby="whatsapp-credentials" className="grid gap-4 rounded-xl border p-4">
          <div className="grid gap-1">
            <h2 id="whatsapp-credentials" className="text-base font-semibold">
              Credenciales
            </h2>
            <p className="text-sm text-muted-foreground">Se guardan cifradas y nunca se muestran enteras. Un cambio solo se guarda si Meta lo valida.</p>
          </div>
          <dl className="grid gap-4">
            <Row label="Token">
              <span className="font-mono">{panel.secrets.accessToken ?? "Sin guardar"}</span>
              <ChangeSecretDialog channelId={panel.id} kind="accessToken" />
            </Row>
            <Row label="App Secret">
              <span className="font-mono">{panel.secrets.appSecret ?? "Sin guardar"}</span>
              <ChangeSecretDialog channelId={panel.id} kind="appSecret" />
            </Row>
            <Row label="PIN de dos pasos">{panel.secrets.hasPin ? "Guardado, cifrado" : "Sin PIN guardado"}</Row>
          </dl>
          <ApiVersionForm channelId={panel.id} current={panel.graphApiVersion ?? DEFAULT_GRAPH_API_VERSION} />
        </section>
      ) : null}

      <section aria-labelledby="whatsapp-test-mode" className="grid gap-4 rounded-xl border p-4">
        <h2 id="whatsapp-test-mode" className="text-base font-semibold">
          Modo pruebas
        </h2>
        {canManage ? (
          <TestModeForm channelId={channel.id} testMode={channel.testMode} allowlist={channel.testAllowlist} help={TEST_ALLOWLIST_HELP} />
        ) : (
          <p className="text-sm">
            {channel.testMode
              ? `Activado: la IA solo contesta a ${channel.testAllowlist.length === 1 ? "1 contacto" : `${channel.testAllowlist.length} contactos`} de la lista.`
              : "Desactivado: la IA contesta a todos los contactos."}
          </p>
        )}
      </section>

      <section aria-labelledby="whatsapp-settings" className="grid gap-4 rounded-xl border p-4">
        <h2 id="whatsapp-settings" className="text-base font-semibold">
          Envíos y comprobaciones
        </h2>
        {canManage ? (
          <SettingsSwitches
            channelId={panel.id}
            showPayment={!panel.isMetaTestNumber}
            initial={{
              handoffOnSendFailure: panel.config.handoffOnSendFailure,
              appLiveConfirmed: panel.config.appLiveConfirmed,
              paymentMethodConfirmed: panel.paymentMethodConfirmedAt !== null,
            }}
          />
        ) : (
          <ul className="grid gap-1 text-sm">
            <li>Traspasar a una persona si un envío falla: {panel.config.handoffOnSendFailure ? "sí" : "no"}.</li>
            <li>App de Meta publicada (Live): {panel.config.appLiveConfirmed ? "confirmado" : "sin confirmar"}.</li>
            {panel.isMetaTestNumber ? null : <li>Método de pago en WhatsApp Manager: {panel.paymentMethodConfirmedAt ? "confirmado" : "sin confirmar"}.</li>}
          </ul>
        )}
      </section>

      <TemplatesSection channelId={panel.id} templates={templates} canSync={metaActions} timezone={timezone} />
      <NoticesSection notices={notices} timezone={timezone} />
      <MetaLimits />
    </>
  );
}
