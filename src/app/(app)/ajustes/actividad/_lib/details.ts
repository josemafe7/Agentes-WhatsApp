// Spanish names and values for the details of an activity log entry ([AJU-10], [SEG-10]): the `metadata` that src/data
// and src/server write with writeAudit(), already secret-stripped. A name or a value without a label here (from a newer
// version) shows as it was written. Identifiers are shortened: on screen they only tell one object from another.
import { formatFileSize, HANDOFF_TRIGGER_LABELS, STATUS_META, URGENCY_LABELS } from "@/app/(app)/bandeja/_lib/presentation";
import { BOOKING_STATUS_DISPLAY } from "@/lib/booking-display";
import { CHANNEL_KIND_LABELS, CONSENT_METHOD_LABELS, PERMISSION_LABELS } from "@/lib/consents";
import type { Audience, ChannelType, KbSourceType, ReminderChannel, SystemEmailTransport, TeamAccess } from "@/lib/enums";
import { formatDateTime } from "@/lib/format";
import { pricingCategoryName } from "@/lib/meta/pricing";
import { ROLE_LABELS } from "@/lib/permissions";
import { SECTOR_PRESETS } from "@/lib/sectors";
import { WHATSAPP_VIA_SHORT_LABELS } from "@/lib/whatsapp-via";
import { EVENT_LABELS } from "../../notificaciones/_lib/labels";
import { marketName } from "../../whatsapp/_lib/labels";

/** One detail of an entry. `full` is the whole identifier when `value` is only its beginning. */
export type DetailItem = { label: string; value: string; full?: string };

const DETAIL_LABELS: Record<string, string> = {
  role: "rol",
  from: "antes",
  to: "después",
  fields: "campos",
  channels: "canales",
  contacts: "contactos",
  enabled: "activado",
  ok: "correcto",
  via: "vía",
  type: "tipo",
  step: "paso",
  version: "versión",
  restoredVersion: "versión recuperada",
  members: "personas",
  attached: "añadida",
  count: "cuántas",
  reason: "motivo",
  mode: "modo",
  name: "nombre",
  // Signing in ([SEG-10], src/app/(auth)/_lib/sign-in.ts).
  twoFactor: "con verificación en dos pasos",
  // An agent's tool ([HER-03]): which one and, for an HTTP tool, the service it called (never its data or secrets).
  tool: "herramienta",
  toolId: "identificador de la herramienta",
  requested: "pedida",
  error: "error",
  method: "método",
  host: "servidor",
  status: "respuesta",
  durationMs: "milisegundos",
  parameters: "parámetros",
  headers: "cabeceras",
  headersRetyped: "cabeceras escritas de nuevo",
  agents: "agentes que la usaban",
  // Agents and who may use an internal one ([INT-05]).
  agentId: "agente",
  previousAgentId: "agente anterior",
  template: "plantilla",
  audience: "para",
  teamAccess: "acceso",
  people: "personas elegidas",
  detachedChannels: "canales que se quedan sin agente",
  fileId: "archivo",
  tokens: "tokens",
  // Knowledge ([CON-04], [CON-09]).
  kbId: "base de conocimiento",
  sourceType: "contenido",
  kind: "formato",
  sitemap: "con mapa del sitio",
  hours: "horas entre refrescos",
  documents: "documentos",
  model: "modelo",
  added: "añadidas",
  removed: "quitadas",
  // Channels and the WhatsApp rates ([AJU-09]).
  channelId: "canal",
  channel: "canal",
  replaced: "sustituyó a otra dirección",
  removedFromMeta: "quitado también de Meta",
  again: "otra vez",
  loggedOut: "sesión cerrada en WhatsApp",
  appSecretReused: "App Secret reutilizado",
  total: "total",
  country: "mercado",
  category: "categoría",
  // Inbox: hand-offs, assignments and drafts.
  trigger: "origen",
  rule: "motivo",
  urgency: "urgencia",
  assigned: "asignada",
  messageId: "mensaje",
  edited: "editado",
  // A report table downloaded ([SEG-10], src/app/(app)/informes/actions.ts).
  table: "tabla",
  firstDay: "desde",
  lastDay: "hasta",
  channelFiltered: "solo un canal",
  // Contacts and their data rights ([CTO-06], [CTO-07]): numbers only, never who the customer was.
  conversations: "conversaciones",
  messages: "mensajes",
  files: "archivos",
  bookings: "citas",
  bookingsAnonymized: "citas anonimizadas",
  mergedContactId: "contacto fusionado",
  joinedConversations: "conversaciones unidas",
  identities: "identidades",
  consents: "consentimientos y bajas",
  // Permissions and bajas ([CTO-09], [CTO-10]): which, how it was given, and how many.
  permission: "permiso",
  granted: "dado",
  how: "cómo",
  scope: "de qué",
  channelKind: "canal",
  channelKinds: "canales",
  marked: "marcados",
  already: "ya lo tenían",
  skipped: "saltados",
  // What each button of a WhatsApp template does ([AGD-32], [WA-62]).
  buttons: "botones",
  selected: "solo los seleccionados",
  filtered: "con filtros",
  source: "origen",
  // Agenda, opening hours and the business settings.
  timeOffId: "ausencia o bloqueo",
  deleted: "borradas",
  ranges: "tramos de horario",
  closures: "festivos o cierres",
  startDate: "desde",
  endDate: "hasta",
  contentType: "formato",
  size: "tamaño",
  events: "avisos",
  sector: "sector",
  presetLoaded: "plantilla del sector cargada",
  logo: "con logo",
  file: "archivo",
  // The daily clean-up ([CUM-06], src/server/compliance/retention.ts).
  webhookEvents: "avisos en bruto borrados",
  audioFiles: "notas de voz borradas",
  attachmentFiles: "adjuntos borrados",
  conversationsDeleted: "conversaciones borradas",
  conversationsAnonymized: "conversaciones anonimizadas",
  messagesDeleted: "mensajes borrados",
  messagesAnonymized: "mensajes anonimizados",
  notesDeleted: "notas internas borradas",
  notificationsDeleted: "avisos del equipo borrados",
  campaignResultsAnonymized: "resultados de envíos anonimizados",
};

/** Details whose name says something else in one action. */
const ACTION_DETAIL_LABELS: Record<string, Record<string, string>> = {
  "agent.duplicated": { from: "copia de" },
  "booking.created": { status: "estado" },
  "booking.status_changed": { status: "estado" },
  "booking.test_deleted": { deleted: "citas borradas" },
  "conversation.status_changed": { status: "estado" },
  "conversation.ai_changed": { mode: "IA" },
  "contacts.exported": { count: "contactos" },
  "contacts.imported": { fileName: "archivo", imported: "importados", skipped: "saltados por repetidos", errors: "filas con errores" },
  "campaign.scheduled": { now: "ahora", rule: "automático o repetido", truncated: "más de 20.000 contactos (solo salió a los primeros)" },
  "campaign.paused": { by: "por" },
  "campaign_rule.created": { kind: "tipo", active: "activo" },
  "campaign_rule.updated": { kind: "tipo" },
  "campaign_rule.activated": { kind: "tipo" },
  "campaign_rule.paused": { kind: "tipo" },
  "campaign_rule.deleted": { kind: "tipo" },
  "campaign_rule.missed": { day: "día" },
  "campaigns.settings_updated": {
    sendStart: "desde",
    sendEnd: "hasta",
    minDaysBetween: "días entre envíos",
    systemMailDailyCap: "tope diario del correo",
    emailPerHour: "correos de envíos por hora",
    emailPerDay: "correos de envíos al día",
  },
  "knowledge.all_reindexed": { count: "bases de conocimiento" },
  "ai.tool_calls_skipped": { count: "herramientas pedidas" },
  "channel.templates_synced": { total: "plantillas" },
  "channel.template_created": { approvedAs: "aprobada como", language: "idioma" },
  "simulator.message_sent": { contentType: "tipo de mensaje" },
};

const TEAM_ACCESS_NAMES: Record<TeamAccess, string> = { everyone: "Todo el equipo", selected: "Personas concretas" };
const AUDIENCE_NAMES: Record<Audience, string> = { customers: "los clientes", team: "el equipo" };
const SOURCE_TYPE_NAMES: Record<KbSourceType, string> = { file: "Archivo", url: "Página web", faq: "Pregunta frecuente", text: "Texto" };
const REMINDER_CHANNEL_NAMES: Record<ReminderChannel, string> = { whatsapp_template: "WhatsApp", email: "Correo" };
const MAIL_TRANSPORT_NAMES: Record<SystemEmailTransport, string> = { smtp: "servidor de correo", outbox: "bandeja local" };
const CHANNEL_TYPE_NAMES: Record<ChannelType, string> = {
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  email_gmail: "Gmail",
  email_outlook: "Outlook",
  email_imap: "Correo (IMAP/SMTP)",
  webchat: "Chat web",
  telegram: "Telegram",
};

function labelsOf<V>(source: Record<string, V>, label: (value: V) => string): Record<string, string> {
  return Object.fromEntries(Object.entries(source).map(([key, value]) => [key, label(value)]));
}

const SECTOR_NAMES = labelsOf(SECTOR_PRESETS, (preset) => preset.label);

/** Closed values of a detail, by its name. The same word can mean something else under another name. */
const VALUE_LABELS: Record<string, Record<string, string>> = {
  // A role given, taken away or changed; «from» is also the agent a copy was made from, which is no role.
  role: ROLE_LABELS,
  from: ROLE_LABELS,
  to: ROLE_LABELS,
  teamAccess: TEAM_ACCESS_NAMES,
  audience: AUDIENCE_NAMES,
  sourceType: SOURCE_TYPE_NAMES,
  channel: REMINDER_CHANNEL_NAMES,
  type: CHANNEL_TYPE_NAMES,
  via: { ...WHATSAPP_VIA_SHORT_LABELS, ...MAIL_TRANSPORT_NAMES },
  // A booking's or a conversation's state; an HTTP tool's answer is a number and stays as it is.
  status: { ...labelsOf(BOOKING_STATUS_DISPLAY, (state) => state.label), ...labelsOf(STATUS_META, (state) => state.label) },
  trigger: HANDOFF_TRIGGER_LABELS,
  urgency: URGENCY_LABELS,
  // What handed a conversation over without a person or the AI asking (src/server/engine/reply.ts).
  rule: {
    keyword: "palabra clave",
    sensitive_topic: "tema sensible",
    unknown_answers: "la IA no sabía responder",
    ai_failure: "la IA ha fallado",
    send_failed: "no se pudo enviar la respuesta",
  },
  // The AI of a conversation (on, off, paused) and where a tool ran («Probar agente» or a real conversation).
  mode: { on: "encendida", off: "apagada", pause: "en pausa", test: "prueba", live: "real" },
  // An automatic or repeated envío ([ENV-15], [ENV-16]); who stopped an envío ([ENV-09]).
  kind: { after_booking: "tras la cita", weekly: "cada semana", monthly: "cada mes" },
  by: { system: "la app", person: "una persona" },
  reason: {
    disabled: "usuario desactivado",
    invalid_credentials: "email o contraseña incorrectos",
    two_factor_invalid: "código de dos pasos incorrecto",
    inviter_disabled: "se desactivó a quien la envió",
    inviter_removed: "se borró a quien la envió",
    inviter_role_changed: "quien la envió cambió de rol",
    too_many: "demasiadas a la vez",
    handed_off: "la conversación ya la lleva una persona",
  },
  source: { keyword: "palabra de baja", person: "una persona", ai: "la IA", template_button: "botón de una plantilla", whatsapp_app: "desde WhatsApp", telegram_button: "botón de Telegram", email_link: "enlace de baja de un correo" },
  permission: PERMISSION_LABELS,
  how: CONSENT_METHOD_LABELS,
  scope: { all: "de todo", marketing: "novedades y publicidad" },
  channelKind: CHANNEL_KIND_LABELS,
  channelKinds: CHANNEL_KIND_LABELS,
  buttons: { confirm: "Confirmo", change: "Necesito cambiarla", marketing_opt_out: "baja de publicidad" },
  events: labelsOf(EVENT_LABELS, (event) => event.label),
  sector: SECTOR_NAMES,
  template: SECTOR_NAMES,
  // The simulator ([AJU-12]): what was sent and whose file it was.
  contentType: { text: "Texto", audio: "Nota de voz", image: "Imagen", document: "Documento" },
  file: { sample: "de ejemplo", upload: "subido" },
  // Why a tool did not run or failed (src/server/ai/tools/registry.ts and http-tool.ts).
  error: {
    unavailable: "herramienta no disponible",
    invalid_json: "la IA envió datos ilegibles",
    invalid_arguments: "la IA envió datos no válidos",
    failed: "fallo inesperado",
    invalid_value: "valor no válido para la dirección",
    invalid_url: "dirección no válida",
    https_required: "la dirección no es https",
    port_not_allowed: "puerto no permitido",
    blocked_address: "dirección no pública",
    host_not_found: "servidor no encontrado",
    redirect: "redirección no seguida",
    timeout: "tiempo de espera agotado",
    network: "no se pudo conectar",
    http_status: "el servicio respondió con un error",
    secrets_unreadable: "no se pudieron leer sus claves",
  },
};

/** «24 dic 2026» for a day stored as aaaa-mm-dd; noon keeps it the same day whatever the zone. */
function dayText(value: string | number): string {
  return (/^\d{4}-\d{2}-\d{2}$/.test(String(value)) && formatDateTime(`${value}T12:00:00Z`, "UTC", { preset: "date" })) || String(value);
}

/** Values that are worded rather than looked up: a day, a market, a size. */
const VALUE_FORMATS: Record<string, (value: string | number) => string> = {
  startDate: dayText,
  endDate: dayText,
  firstDay: dayText,
  lastDay: dayText,
  country: (value) => marketName(String(value)),
  category: (value) => pricingCategoryName(String(value)),
  approvedAs: (value) => pricingCategoryName(String(value)),
  size: (value) => (typeof value === "number" ? formatFileSize(value) : value),
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHORT_ID_LENGTH = 8;

/** The object's own entry: a detail could be called «constructor». */
function own<V>(map: Record<string, V>, key: string): V | undefined {
  return Object.hasOwn(map, key) ? map[key] : undefined;
}

function scalarText(key: string, value: string | number): string {
  const known = own(own(VALUE_LABELS, key) ?? {}, String(value));
  return known ?? own(VALUE_FORMATS, key)?.(value) ?? String(value);
}

function valueText(key: string, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "sí" : "no";
  if (typeof value === "string" || typeof value === "number") return scalarText(key, value);
  if (Array.isArray(value) && value.every((item) => typeof item === "string" || typeof item === "number")) {
    return value.map((item) => scalarText(key, item)).join(", ");
  }
  return null;
}

/**
 * The details of an entry (already secret-stripped) with their Spanish names and values, as `action` words them; nested
 * objects are left out.
 */
export function detailItems(details: Record<string, unknown>, action?: string): DetailItem[] {
  const names = action ? own(ACTION_DETAIL_LABELS, action) : undefined;
  const items: DetailItem[] = [];
  for (const [key, value] of Object.entries(details)) {
    const text = valueText(key, value);
    if (text === null || text === "") continue;
    const label = (names && own(names, key)) ?? own(DETAIL_LABELS, key) ?? key;
    items.push(UUID.test(text) ? { label, value: `${text.slice(0, SHORT_ID_LENGTH)}…`, full: text } : { label, value: text });
  }
  return items;
}

/** The same details as «nombre: valor» lines of plain text, identifiers whole. */
export function detailLines(details: Record<string, unknown>, action?: string): string[] {
  return detailItems(details, action).map((item) => `${item.label}: ${item.full ?? item.value}`);
}
