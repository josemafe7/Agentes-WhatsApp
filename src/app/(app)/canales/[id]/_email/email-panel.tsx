import { CircleCheck, CircleX, Info, TriangleAlert, Unplug } from "lucide-react";
import type { ReactNode } from "react";
import { CopyButton } from "@/components/copy-button";
import { StatusLight } from "@/components/status-light";
import type { ChannelDetail } from "@/data/channels";
import { getEmailChannelView, type EmailChannelView } from "@/data/email";
import { getEmailChannelCounters } from "@/data/email-panel";
import { formatDateTime } from "@/lib/format";
import type { Actor } from "@/lib/permissions";
import { REPLY_MODE_OPTIONS } from "../../_lib/labels";
import { EMAIL_PROVIDER_OPTIONS } from "../../nuevo/correo/_lib/steps";
import {
  disconnectConsequences,
  emailHealthLights,
  emailPanelState,
  oauthReturnNotice,
  reconnectPlan,
  type EmailPanelState,
  type OAuthReturnNotice,
  type ReconnectPlan,
  type SearchParams,
} from "./_lib/view";
import { AdminConsentButton } from "./admin-consent-button";
import { ChangeOutlookSecretDialog } from "./change-outlook-secret-dialog";
import { EmailActivity } from "./email-activity";
import { EmailPanelActions } from "./email-panel-actions";
import { EmailSettingsForm } from "./email-settings-form";
import { PanelAlert } from "./panel-alert";
import { ReconnectControl } from "./reconnect-control";

type EmailPanelProps = {
  actor: Actor;
  channel: ChannelDetail;
  canManage: boolean;
  timezone: string;
  businessName: string;
  /** `?conexion`, `?motivo` and `?consentimiento` from the OAuth callbacks ([COR-23]). */
  searchParams: SearchParams;
};

const SECURITY_LABELS: Record<string, string> = { tls: "SSL/TLS", starttls: "STARTTLS" };

const ASK_A_MANAGER = "Pide al propietario o a un administrador que lo conecte.";

type AlertsProps = { view: EmailChannelView; state: EmailPanelState; plan: ReconnectPlan; notice: OAuthReturnNotice | null; canManage: boolean };

/** What needs attention first: the return from Google or Microsoft, demo, reconnection, not connected, the secret. */
function EmailAlerts({ view, state, plan, notice, canManage }: AlertsProps) {
  const alerts: ReactNode[] = [];
  const connect = (label: string) => (canManage ? <div><ReconnectControl channelId={view.id} plan={plan} label={label} /></div> : <p>{ASK_A_MANAGER}</p>);
  if (notice) {
    const consent = notice.reason === "admin_consent_required" && canManage && view.outlook?.adminConsentAvailable;
    alerts.push(
      <PanelAlert key="return" tone={notice.tone === "success" ? "success" : "error"} icon={notice.tone === "success" ? CircleCheck : CircleX} title={notice.title}>
        <p>{notice.text}</p>
        {consent ? (
          <div>
            <AdminConsentButton channelId={view.id} />
          </div>
        ) : null}
      </PanelAlert>,
    );
  }
  if (state === "demo") {
    alerts.push(
      <PanelAlert key="demo" tone="info" icon={Info} title="Buzón de demostración">
        <p>No se conecta a ningún servidor de correo: los semáforos y las acciones con el proveedor no se aplican. Sus correos se prueban con el simulador de Diagnóstico.</p>
      </PanelAlert>,
    );
  }
  if (state === "reconnect" && view.reconnect) {
    alerts.push(
      <PanelAlert key="reconnect" tone="error" icon={CircleX} title={view.reconnect.label}>
        <p>{view.reconnect.reason}</p>
        <p>Mientras tanto no se leen ni se envían correos de este buzón. Al reconectar no se pierde nada: se sigue leyendo desde donde se quedó.</p>
        {connect("Reconectar")}
      </PanelAlert>,
    );
  }
  if (state === "not_connected") {
    alerts.push(
      <PanelAlert key="not-connected" tone="warning" icon={Unplug} title="Este buzón no está conectado">
        <p>No lee ni envía correos. Sus conversaciones se conservan.</p>
        {connect("Conectar")}
      </PanelAlert>,
    );
  }
  // The Outlook Client Secret: warned 30 days before; once past, Microsoft refuses the access ([COR-07], [COR-22]).
  const secret = view.outlook?.secretExpiry;
  if (secret && (state === "connected" || state === "error") && secret.status !== "ok") {
    const expired = secret.status === "error";
    alerts.push(
      <PanelAlert key="secret" tone={expired ? "error" : "warning"} icon={expired ? CircleX : TriangleAlert} title={expired ? "El Client Secret ha caducado" : "El Client Secret caduca pronto"}>
        <p>
          {expired
            ? "Microsoft ya no acepta el acceso de este buzón. Crea un Client Secret nuevo en Microsoft Entra y reconecta."
            : "Cuando caduque, Microsoft dejará de dar acceso y el buzón pasará a «Requiere reconexión». Crea uno nuevo en Microsoft Entra y ponlo aquí antes."}
        </p>
        {canManage ? <div>{expired ? <ReconnectControl channelId={view.id} plan={plan} label="Reconectar" /> : <ChangeOutlookSecretDialog channelId={view.id} />}</div> : null}
      </PanelAlert>,
    );
  }
  return alerts.length > 0 ? <div className="grid gap-3">{alerts}</div> : null;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[180px_1fr] sm:items-center sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-2 text-sm break-words">{children}</dd>
    </div>
  );
}

const server = (host: string | null, port: number | null, security: string | null) =>
  host ? `${host}:${port ?? "?"}${security ? ` · ${SECURITY_LABELS[security] ?? security}` : ""}` : "Sin guardar";

/** The mailbox's settings. Credentials only for owner and admin, and secrets always masked ([PER-03], [PER-07]). */
function MailboxDetails({ view, canManage, timezone }: { view: EmailChannelView; canManage: boolean; timezone: string }) {
  const masked = (value: string | null) => <span className="font-mono break-all">{value ?? "Sin guardar"}</span>;
  return (
    <dl className="grid gap-3">
      <Row label="Dirección">{view.emailAddress ?? "Sin conectar todavía"}</Row>
      <Row label="Tipo">{EMAIL_PROVIDER_OPTIONS.find((option) => option.type === view.type)?.label ?? view.type}</Row>
      {view.imap ? (
        <>
          <Row label="Entrada (IMAP)">{server(view.imap.imapHost, view.imap.imapPort, view.imap.imapSecurity)}</Row>
          <Row label="Envío (SMTP)">{server(view.imap.smtpHost, view.imap.smtpPort, view.imap.smtpSecurity)}</Row>
        </>
      ) : null}
      {canManage && view.gmail ? (
        <>
          <Row label="Client ID">{masked(view.gmail.clientId)}</Row>
          <Row label="Client Secret">{masked(view.gmail.clientSecret)}</Row>
          <Row label="URI de redirección">
            <span className="font-mono break-all">{view.gmail.redirectUri}</span>
            <CopyButton value={view.gmail.redirectUri} />
          </Row>
        </>
      ) : null}
      {canManage && view.outlook ? (
        <>
          <Row label="Client ID">{masked(view.outlook.clientId)}</Row>
          <Row label="Tenant ID">{masked(view.outlook.tenant)}</Row>
          <Row label="Client Secret">{masked(view.outlook.clientSecret)}</Row>
          <Row label="Caducidad del secreto">
            {view.outlook.clientSecretExpiresAt ? formatDateTime(view.outlook.clientSecretExpiresAt, "UTC", { preset: "long-date" }) : "Sin guardar"}
          </Row>
          <Row label="URI de redirección">
            <span className="font-mono break-all">{view.outlook.redirectUri}</span>
            <CopyButton value={view.outlook.redirectUri} />
          </Row>
        </>
      ) : null}
      {canManage && view.imap ? (
        <>
          <Row label="Usuario">{view.imap.username ?? view.emailAddress ?? "Sin guardar"}</Row>
          <Row label="Contraseña">{masked(view.imap.password)}</Row>
        </>
      ) : null}
      {view.health ? <Row label="Última revisión">{formatDateTime(view.health.checkedAt, timezone)}</Row> : null}
    </dl>
  );
}

/**
 * The email part of a mailbox's panel (docs/pantallas.md «Panel del canal», [CAN-15], [CAN-16], [COR-07], [COR-11],
 * [COR-14], [COR-16], [COR-17], [COR-21]–[COR-23]). Owner and admin act; Solo lectura only looks and never sees a
 * credential ([PER-03], [PER-07]). Each action checks the permission again on the server ([SEG-04]).
 */
export async function EmailPanel({ actor, channel, canManage, timezone, businessName, searchParams }: EmailPanelProps) {
  const [view, counters] = await Promise.all([getEmailChannelView(actor, channel.id), getEmailChannelCounters(actor, channel.id)]);
  const state = emailPanelState(view);
  const plan = reconnectPlan(view, { hasSecrets: channel.hasSecrets });
  const lights = emailHealthLights(view, { timezone, now: new Date() });
  // Talks to the provider only with credentials stored, never for a demo mailbox ([ARR-11]).
  const live = !view.isDemo && channel.hasSecrets;
  const reading = live && (state === "connected" || state === "error" || state === "connecting");

  return (
    <>
      <EmailAlerts view={view} state={state} plan={plan} notice={oauthReturnNotice(searchParams)} canManage={canManage} />

      <section aria-labelledby="email-mailbox" className="grid gap-4 rounded-xl border p-4">
        <div className="grid gap-3">
          <h2 id="email-mailbox" className="text-base font-semibold">
            Buzón de correo
          </h2>
          <MailboxDetails view={view} canManage={canManage} timezone={timezone} />
          {canManage ? (
            <EmailPanelActions
              channelId={view.id}
              channelName={view.name}
              aiEnabled={channel.aiEnabled}
              can={{ revalidate: reading, pollNow: reading, testConnection: live && view.type === "email_imap", disconnect: live }}
              disconnectText={disconnectConsequences(view.type)}
              reconnect={plan}
            />
          ) : null}
        </div>
        <div className="grid gap-3">
          {lights.map((light) => (
            <StatusLight key={light.key} status={light.status} label={light.label} detail={light.detail} />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Se lee cada minuto. Si falla tres veces seguidas o el acceso deja de valer, el canal pasa a «Error» o «Requiere reconexión» y se avisa al
          propietario y a los administradores.
        </p>
      </section>

      <EmailActivity view={view} counters={counters} />

      <section aria-labelledby="email-replies" className="grid gap-4 rounded-xl border p-4">
        <div className="grid gap-1">
          <h2 id="email-replies" className="text-base font-semibold">
            Respuestas de la IA
          </h2>
          <p className="text-sm text-muted-foreground">Cada correo de la IA sale en el mismo hilo y con el mismo asunto.</p>
        </div>
        {canManage ? (
          <EmailSettingsForm
            channelId={view.id}
            businessName={businessName}
            initial={{
              replyMode: channel.replyMode,
              dailyCapPerThread: String(view.settings.dailyCapPerThread),
              dailyCapPerSender: String(view.settings.dailyCapPerSender),
              signature: view.settings.signature ?? "",
              ...(view.type === "email_imap" ? { imapIdle: view.settings.imapIdle } : {}),
            }}
          />
        ) : (
          <dl className="grid gap-3">
            <Row label="Modo de respuesta">{REPLY_MODE_OPTIONS.find((option) => option.value === channel.replyMode)?.label ?? channel.replyMode}</Row>
            <Row label="Tope diario">{`${view.settings.dailyCapPerThread} por hilo y ${view.settings.dailyCapPerSender} por remitente`}</Row>
            <Row label="Firma">{view.settings.signature ?? `Por defecto: ${businessName}`}</Row>
            {view.type === "email_imap" ? <Row label="Leer al momento">{view.settings.imapIdle ? "Sí, con pnpm worker" : "No: se lee cada minuto"}</Row> : null}
          </dl>
        )}
      </section>
    </>
  );
}
