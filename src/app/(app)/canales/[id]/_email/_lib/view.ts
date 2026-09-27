// What the email panel shows, worded in Spanish ([CAN-15], [COR-03], [COR-07], [COR-16], [COR-22], [COR-23]): the
// traffic lights in their order, the return from Google or Microsoft (only its code travels in the URL), how
// «Reconectar» works for each provider, and which emails are never answered. Server side (the panel) and its tests.
import type { StatusLightStatus } from "@/components/status-light";
import type { EmailChannelView } from "@/data/email";
import { formatDateTime, formatRelative } from "@/lib/format";
import type { OAuthFailure } from "@/server/channels/email/oauth-results";
import { readConnectionOutcome } from "../../../nuevo/correo/_lib/connection";

type EmailChannelType = EmailChannelView["type"];

/** A mailbox is read every minute: this long without reading means the background work is not running. */
export const STALE_SYNC_MS = 10 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

// ─── State and lights ───────────────────────────────────────────────────────────────────────────────────

/** «connecting»: switched on again after «Desactivar»; the next read (every minute) connects it. */
export type EmailPanelState = "demo" | "reconnect" | "disabled" | "not_connected" | "connecting" | "error" | "connected";

export function emailPanelState(view: Pick<EmailChannelView, "isDemo" | "reconnect" | "status">): EmailPanelState {
  if (view.isDemo) return "demo";
  if (view.reconnect) return "reconnect";
  if (view.status === "disabled") return "disabled";
  if (view.status === "draft") return "not_connected";
  if (view.status === "connecting") return "connecting";
  return view.status === "error" ? "error" : "connected";
}

export type EmailLight = { key: string; label: string; status: StatusLightStatus; detail: string };

/** Why a mailbox that is not read shows every light off. */
const NOT_CHECKED: Partial<Record<EmailPanelState, string>> = {
  demo: "Buzón de demostración: no se conecta a ningún servidor.",
  not_connected: "Sin conectar todavía.",
  disabled: "Canal desactivado: no lee el buzón ni envía.",
};

const checkOf = (view: EmailChannelView, key: string) => view.health?.checks.find((check) => check.key === key) ?? null;

function connectionLight(view: EmailChannelView, state: EmailPanelState): EmailLight {
  const light = { key: "connection", label: "Conexión" };
  const idle = NOT_CHECKED[state];
  if (idle) return { ...light, status: "off", detail: idle };
  if (view.reconnect) return { ...light, status: "error", detail: `${view.reconnect.label}: ${view.reconnect.reason}` };
  if (state === "connecting") return { ...light, status: "pending", detail: "Se comprueba en la próxima lectura del buzón, dentro de un minuto como mucho." };
  const check = checkOf(view, "connection");
  if (check) return { ...light, status: check.status, detail: check.detail ?? "" };
  return { ...light, status: "ok", detail: view.emailAddress ? `Conectado a ${view.emailAddress}` : "Conectado" };
}

function permissionsLight(view: EmailChannelView, state: EmailPanelState): EmailLight {
  const light = { key: "permissions", label: "Permisos" };
  const idle = NOT_CHECKED[state];
  if (idle) return { ...light, status: "off", detail: idle };
  const check = checkOf(view, "permissions");
  if (check) return { ...light, status: check.status, detail: check.detail ?? "" };
  if (view.grantedScopes.length > 0) return { ...light, status: "ok", detail: "Concedidos al conectar: leer, enviar y modificar el correo." };
  return { ...light, status: "off", detail: "Sin comprobar. Pulsa «Revalidar»." };
}

function lastReadLight(view: EmailChannelView, state: EmailPanelState, context: { timezone: string; now: Date }): EmailLight {
  const light = { key: "last_read", label: "Última lectura" };
  const at = view.lastSyncAt ? new Date(view.lastSyncAt) : null;
  const when = at && !Number.isNaN(at.getTime()) ? `${formatDateTime(at, context.timezone)} (${formatRelative(at, context.timezone, context.now)})` : null;
  if (state === "demo") return { ...light, status: "off", detail: "Sus correos llegan con el simulador de Diagnóstico." };
  if (state !== "connected") return { ...light, status: "off", detail: when ?? "Todavía no se ha leído el buzón." };
  if (!at || !when) return { ...light, status: "warn", detail: "Todavía no se ha leído el buzón. Se lee cada minuto." };
  if (context.now.getTime() - at.getTime() > STALE_SYNC_MS) {
    return { ...light, status: "warn", detail: `${when}. Lleva un rato sin leerse: revisa que el trabajo en segundo plano esté en marcha (Ajustes › Diagnóstico).` };
  }
  return { ...light, status: "ok", detail: when };
}

/** [COR-07] [COR-22]: the date the business gave when saving the secret; warned 30 days before, error once past. */
function secretExpiryLight(view: EmailChannelView, context: { timezone: string; now: Date }): EmailLight {
  const light = { key: "secret_expiry", label: "Caducidad del Client Secret" };
  const expiry = view.outlook?.secretExpiry ?? null;
  const at = view.outlook?.clientSecretExpiresAt ? new Date(view.outlook.clientSecretExpiresAt) : null;
  if (!expiry || !at || Number.isNaN(at.getTime())) return { ...light, status: "off", detail: "No se ha guardado la fecha de caducidad del Client Secret." };
  const date = formatDateTime(at, "UTC", { preset: "long-date" });
  if (expiry.status === "error") return { ...light, status: "error", detail: `Caducó el ${date}. Crea uno nuevo en Microsoft Entra y ponlo aquí.` };
  if (expiry.status === "warn") {
    const days = Math.ceil((at.getTime() - context.now.getTime()) / DAY_MS);
    return { ...light, status: "warn", detail: `Caduca el ${date} (${days === 1 ? "mañana" : `en ${days} días`}). Crea uno nuevo en Microsoft Entra y ponlo aquí antes.` };
  }
  return { ...light, status: "ok", detail: `Caduca el ${date}.` };
}

function foldersLight(view: EmailChannelView, state: EmailPanelState): EmailLight {
  const light = { key: "folders", label: "Carpetas" };
  const idle = NOT_CHECKED[state];
  if (idle) return { ...light, status: "off", detail: idle };
  const sent = view.imap?.sentPath;
  const drafts = view.imap?.draftsPath;
  if (!sent) return { ...light, status: "warn", detail: "No se ha encontrado la carpeta de enviados: lo que envía la app no quedará en tu buzón." };
  return { ...light, status: "ok", detail: drafts ? `Enviados: ${sent} · Borradores: ${drafts}` : `Enviados: ${sent} · Sin carpeta de borradores` };
}

/** Every light of the mailbox in the panel's order: connection, permissions (OAuth), last read and the provider's own. */
export function emailHealthLights(view: EmailChannelView, context: { timezone: string; now: Date }): EmailLight[] {
  const state = emailPanelState(view);
  const lights = [connectionLight(view, state)];
  if (view.type !== "email_imap") lights.push(permissionsLight(view, state));
  lights.push(lastReadLight(view, state, context));
  if (view.type === "email_outlook") lights.push(secretExpiryLight(view, context));
  if (view.type === "email_gmail") {
    const access = checkOf(view, "access_expiry");
    if (access && !NOT_CHECKED[state]) lights.push({ key: "access_expiry", label: "Caducidad del acceso", status: access.status, detail: access.detail ?? "" });
  }
  if (view.type === "email_imap") lights.push(foldersLight(view, state));
  return lights;
}

// ─── Return from Google or Microsoft ([COR-03], [COR-23]) ───────────────────────────────────────────────

export type SearchParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export type OAuthReturnNotice = { tone: "success" | "error"; title: string; text: string; reason: OAuthFailure | null };

/** What the callback put in the URL: only known codes, as their Spanish text (the wizard reads them the same way). */
export function oauthReturnNotice(query: SearchParams): OAuthReturnNotice | null {
  const outcome = readConnectionOutcome({ conexion: first(query.conexion), motivo: first(query.motivo), consentimiento: first(query.consentimiento) });
  if (!outcome) return null;
  if (outcome.kind === "connected") {
    return { tone: "success", title: "Buzón conectado", text: "La app ya lee este buzón: los correos nuevos llegan a la bandeja en un minuto como mucho.", reason: null };
  }
  if (outcome.kind === "admin_consent") {
    return {
      tone: "success",
      title: "Consentimiento del administrador concedido",
      text: "La app ya tiene permiso en el tenant del negocio. Ahora conecta el buzón con Microsoft.",
      reason: null,
    };
  }
  return { tone: "error", title: "No se ha podido conectar el buzón", text: outcome.message, reason: outcome.reason };
}

// ─── «Reconectar» ([COR-22]) ────────────────────────────────────────────────────────────────────────────

export type ReconnectPlan =
  /** Demo mailboxes never connect ([ARR-11]). */
  | { kind: "none" }
  /** The OAuth client or the servers were never saved: the wizard. */
  | { kind: "wizard" }
  /** Google or Microsoft again; with a new Client Secret when none is stored or Outlook's expired. */
  | { kind: "oauth"; provider: "google" | "microsoft"; needsSecret: boolean }
  /** The stored servers with a new password. */
  | { kind: "imap" };

/** How the mailbox connects again, keeping its conversations and its reading point. */
export function reconnectPlan(view: EmailChannelView, context: { hasSecrets: boolean }): ReconnectPlan {
  if (view.isDemo) return { kind: "none" };
  if (view.type === "email_gmail") return view.gmail?.clientId ? { kind: "oauth", provider: "google", needsSecret: !context.hasSecrets } : { kind: "wizard" };
  if (view.type === "email_outlook") {
    const outlook = view.outlook;
    if (!outlook?.clientId || !outlook.tenant) return { kind: "wizard" };
    return { kind: "oauth", provider: "microsoft", needsSecret: !context.hasSecrets || outlook.secretExpiry?.status === "error" };
  }
  const imap = view.imap;
  const complete = view.emailAddress && imap?.imapHost && imap.imapPort && imap.imapSecurity && imap.smtpHost && imap.smtpPort && imap.smtpSecurity;
  return complete ? { kind: "imap" } : { kind: "wizard" };
}

// ─── Filters ([COR-16], [COR-18], [COR-20]) ─────────────────────────────────────────────────────────────

export type FilterRule = { key: "auto_reply" | "bulk" | "no_reply" | "own" | "spam" | "promotions"; text: string };

// Outlook and IMAP are only read in the inbox (and sent items): their junk folder is never read ([COR-16]).
const SPAM_RULE: Record<EmailChannelType, string> = {
  email_gmail: "Lo que Gmail pone en Spam.",
  email_outlook: "Lo que Outlook pone en Correo no deseado.",
  email_imap: "Lo que el servidor aparta en la carpeta de spam: la app solo lee la bandeja de entrada.",
};

/** Which emails the AI never answers, for this provider. Promotions only exist as a category in Gmail. */
export function filterRules(type: EmailChannelType): FilterRule[] {
  return [
    { key: "auto_reply", text: "Respuestas automáticas: fuera de la oficina, acuses de recibo y parecidas." },
    { key: "bulk", text: "Envíos masivos, listas de correo y boletines con enlace para darse de baja." },
    { key: "no_reply", text: "Remitentes «noreply» o «mailer-daemon», y rebotes de correos que no se entregaron." },
    { key: "own", text: "Lo que envía el propio buzón y lo que envía esta app (lleva la cabecera X-DominIA-Agente), para no responderse a sí misma." },
    { key: "spam", text: SPAM_RULE[type] },
    ...(type === "email_gmail" ? [{ key: "promotions" as const, text: "La categoría «Promociones» de Gmail." }] : []),
  ];
}

/** Outlook has no promotions category: said so the business knows why they reach the inbox ([COR-16]). */
export function filterNote(type: EmailChannelType): string | null {
  if (type === "email_outlook") return "Outlook no tiene categoría de promociones: las que no vayan a Correo no deseado llegan a la bandeja y la IA puede contestarlas.";
  if (type === "email_imap") return "Las promociones no se distinguen por IMAP: las que el servidor no aparte como spam llegan a la bandeja.";
  return null;
}

export function ignoredTotal(ignored: EmailChannelView["ignored"]): number {
  return ignored.reduce((total, item) => total + item.count, 0);
}

/** What «Desconectar» does for each provider ([CAN-16]); Microsoft has no revoke endpoint (docs/integracion-correo.md §2.2). */
export function disconnectConsequences(type: EmailChannelType): string {
  const common = "El canal deja de leer el buzón y queda sin conectar; sus conversaciones se conservan.";
  if (type === "email_gmail") return `Se revoca el acceso en Google y se borran el Client Secret y los tokens guardados. ${common} El Client ID se guarda para volver a conectarlo.`;
  if (type === "email_outlook") {
    return `Se borran el Client Secret y los tokens guardados. Microsoft no permite revocar el acceso desde aquí: si quieres, quita también el permiso de la app en tu cuenta de Microsoft. ${common}`;
  }
  return `Se borra la contraseña guardada. ${common} Los servidores se guardan para volver a conectarlo.`;
}
