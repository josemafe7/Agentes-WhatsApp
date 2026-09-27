// Spanish names for what the activity log records ([AJU-10], [SEG-10]). A test checks that every action the app writes
// has one; an unknown action (from a newer version) shows its code.
import type { AuditActorType } from "@/lib/enums";
import { isRole, ROLE_LABELS } from "@/lib/permissions";

export const ACTOR_TYPE_LABELS: Record<AuditActorType, string> = { user: "Persona", ai: "IA", system: "Sistema" };

/** URL value of each actor type (?quien=…). */
export const ACTOR_TYPE_PARAMS: Record<AuditActorType, string> = { user: "persona", ai: "ia", system: "sistema" };

const ACTION_LABELS: Record<string, string> = {
  // Entrar y salir, y «Mi cuenta».
  "auth.login": "Entró en la app",
  "auth.login_failed": "Intento de entrar fallido",
  "auth.login_blocked": "Intento de entrar frenado por demasiados fallos",
  "auth.logout": "Cerró la sesión",
  "account.name_changed": "Cambió su nombre",
  "account.password_changed": "Cambió su contraseña",
  "account.two_factor_enabled": "Activó la verificación en dos pasos",
  "account.two_factor_disabled": "Desactivó la verificación en dos pasos",
  "account.other_sessions_closed": "Cerró sus sesiones en los demás dispositivos",
  "account.notification_preferences_updated": "Cambió sus avisos",
  // Usuarios e invitaciones.
  "user.invited": "Invitó a una persona",
  "user.invitation_resent": "Reenvió una invitación",
  "user.invitation_revoked": "Revocó una invitación",
  "user.invitation_accepted": "Aceptó una invitación",
  "user.role_changed": "Cambió un rol",
  "user.channels_changed": "Cambió los canales de un agente",
  "user.disabled": "Desactivó a un usuario",
  "user.enabled": "Reactivó a un usuario",
  "user.removed": "Borró a un usuario",
  "user.ownership_transferred": "Traspasó la propiedad",
  // Asistente de arranque.
  "setup.owner_created": "Creó el propietario en el asistente de arranque",
  "setup.business_saved": "Guardó los datos del negocio en el asistente",
  "setup.hours_saved": "Guardó el horario en el asistente",
  "setup.ai_saved": "Guardó la IA en el asistente",
  "setup.agent_created": "Creó el primer agente en el asistente",
  "setup.agent_updated": "Cambió el primer agente en el asistente",
  "setup.webchat_created": "Creó el chat web en el asistente",
  "setup.webchat_kept": "Mantuvo el chat web del asistente",
  "setup.step_skipped": "Saltó un paso del asistente",
  "setup.completed": "Terminó el asistente de arranque",
  // Ajustes.
  "settings.business_updated": "Cambió los ajustes del negocio",
  "settings.logo_updated": "Cambió el logo del negocio",
  "settings.logo_removed": "Quitó el logo del negocio",
  "settings.hours_updated": "Cambió el horario del negocio",
  "settings.closure_added": "Añadió un festivo o cierre",
  "settings.closure_deleted": "Quitó un festivo o cierre",
  "settings.integrations_updated": "Cambió la IA o el correo del sistema",
  "settings.require_2fa_changed": "Cambió la exigencia de verificación en dos pasos",
  "settings.test_email_sent": "Envió un correo de prueba",
  "settings.pricing_rate_saved": "Guardó una tarifa de WhatsApp",
  "settings.pricing_rate_deleted": "Borró una tarifa de WhatsApp",
  "job.retried": "Reintentó un trabajo en segundo plano",
  "job.cancelled": "Canceló un trabajo en segundo plano",
  "retention.cleanup": "Borró datos caducados",
  "report.exported": "Descargó una tabla de los informes",
  "simulator.message_sent": "Envió un mensaje con el simulador",
  // Canales.
  "channel.created": "Creó un canal",
  "channel.connected": "Conectó un canal",
  "channel.reconnected": "Volvió a conectar un canal",
  "channel.disconnected": "Desconectó un canal",
  "channel.updated": "Cambió los ajustes de un canal",
  "channel.configured": "Cambió el aspecto o la configuración de un chat web",
  "channel.agent_changed": "Cambió el agente activo de un canal",
  "channel.members_changed": "Cambió quién atiende un canal",
  "channel.deleted": "Borró un canal",
  "channel.revalidated": "Revalidó un número de WhatsApp con Meta",
  "channel.token_changed": "Cambió el token de un número de WhatsApp",
  "channel.app_secret_changed": "Cambió el App Secret de un número de WhatsApp",
  "channel.api_version_changed": "Cambió la versión de la API de Meta de un número",
  "channel.webhook_subscribed": "Suscribió la app de Meta a los avisos",
  "channel.waba_subscribed": "Suscribió la app a la cuenta de WhatsApp Business",
  "channel.number_registered": "Registró un número de WhatsApp",
  "channel.number_verified": "Verificó un número de WhatsApp",
  "channel.pin_changed": "Cambió el PIN de un número de WhatsApp",
  "channel.templates_synced": "Sincronizó las plantillas de WhatsApp",
  // Contactos y cumplimiento.
  "contact.created": "Creó un contacto",
  "contact.updated": "Editó un contacto",
  "contact.merged": "Fusionó dos contactos",
  "contact.exported": "Exportó los datos de un contacto",
  "contacts.exported": "Exportó la lista de contactos",
  "contact.erased": "Borró los datos de un contacto",
  "consent.opted_out": "Un cliente se dio de baja de un canal",
  "consent.opt_out_lifted": "Quitó la baja de un cliente",
  // Bandeja.
  "conversation.ai_changed": "Cambió la IA de una conversación",
  "conversation.handed_off": "Pasó una conversación a una persona",
  "conversation.status_changed": "Cambió el estado de una conversación",
  "conversation.assigned": "Asignó una conversación",
  "conversation.agent_changed": "Eligió otro agente para una conversación",
  "message.draft_approved": "Aprobó un borrador de la IA",
  "message.draft_discarded": "Descartó un borrador de la IA",
  // Agentes y sus herramientas.
  "agent.created": "Creó un agente",
  "agent.updated": "Cambió un agente",
  "agent.duplicated": "Duplicó un agente",
  "agent.deleted": "Borró un agente",
  "agent.version_restored": "Recuperó una versión de un agente",
  "agent.avatar_updated": "Cambió el avatar de un agente",
  "agent.avatar_removed": "Quitó el avatar de un agente",
  "agent.knowledge_bases_changed": "Cambió las bases de conocimiento de un agente",
  "agent.context_file_added": "Añadió un archivo de contexto a un agente",
  "agent.context_file_updated": "Cambió un archivo de contexto de un agente",
  "agent.context_file_deleted": "Borró un archivo de contexto de un agente",
  "agent.custom_tools_changed": "Cambió las herramientas HTTP de un agente",
  "custom_tool.created": "Creó una herramienta HTTP",
  "custom_tool.updated": "Cambió una herramienta HTTP",
  "custom_tool.deleted": "Borró una herramienta HTTP",
  "custom_tool.tested": "Probó una herramienta HTTP",
  // What the AI does: every tool it uses and, for an HTTP tool, the call to the business's service ([HER-03]).
  "tool.used": "Usó una herramienta",
  "ai.tool_called": "La IA usó una herramienta",
  "ai.http_tool_called": "Llamada de la IA a un servicio externo (herramienta HTTP)",
  "ai.tool_calls_skipped": "La IA pidió herramientas que no se ejecutaron",
  // Conocimiento.
  "knowledge.base_created": "Creó una base de conocimiento",
  "knowledge.base_updated": "Cambió una base de conocimiento",
  "knowledge.base_deleted": "Borró una base de conocimiento",
  "knowledge.base_reindexed": "Volvió a procesar una base de conocimiento",
  "knowledge.all_reindexed": "Volvió a procesar todas las bases de conocimiento",
  "knowledge.model_changed": "Cambió el modelo de embeddings de una base",
  "knowledge.document_added": "Añadió contenido a una base de conocimiento",
  "knowledge.document_updated": "Cambió una pregunta frecuente o un texto",
  "knowledge.document_renamed": "Cambió el título de un documento",
  "knowledge.document_reprocessed": "Volvió a procesar un documento",
  "knowledge.document_refresh_changed": "Cambió el refresco de una página web",
  "knowledge.document_deleted": "Borró un documento del conocimiento",
  // Agenda.
  "booking.created": "Creó una cita",
  "booking.updated": "Editó una cita",
  "booking.moved": "Movió una cita",
  "booking.status_changed": "Cambió el estado de una cita",
  "booking.test_deleted": "Borró las citas de prueba",
  "agenda.settings_updated": "Cambió los ajustes de la agenda",
  "agenda.service_created": "Creó un servicio",
  "agenda.service_updated": "Cambió un servicio",
  "agenda.service_activated": "Activó un servicio",
  "agenda.service_deactivated": "Desactivó un servicio",
  "agenda.resource_created": "Creó un recurso de la agenda",
  "agenda.resource_updated": "Cambió un recurso de la agenda",
  "agenda.resource_activated": "Activó un recurso de la agenda",
  "agenda.resource_deactivated": "Desactivó un recurso de la agenda",
  "agenda.absence_added": "Añadió una ausencia",
  "agenda.slot_blocked": "Bloqueó un hueco de la agenda",
  "agenda.time_off_removed": "Quitó una ausencia o un bloqueo",
  "agenda.reminders_updated": "Cambió los recordatorios de citas",
};

const TARGET_LABELS: Record<string, string> = {
  user: "Usuario",
  invitation: "Invitación",
  business_settings: "Ajustes del negocio",
  business_hours: "Horario",
  closure: "Festivo o cierre",
  integration_settings: "Ajustes de IA y correo",
  pricing_rate: "Tarifa de WhatsApp",
  system_email: "Correo del sistema",
  job: "Trabajo",
  channel: "Canal",
  conversation: "Conversación",
  contact: "Contacto",
  agent: "Agente",
  custom_tool: "Herramienta HTTP",
  knowledge_base: "Base de conocimiento",
  kb_document: "Documento del conocimiento",
  booking: "Cita",
  service: "Servicio",
  resource: "Recurso",
  resource_time_off: "Ausencia o bloqueo",
  reminder_settings: "Recordatorios",
  report: "Informe",
};

const DETAIL_LABELS: Record<string, string> = {
  role: "rol",
  from: "antes",
  to: "después",
  fields: "campos",
  channels: "canales",
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
  // An agent's tool ([HER-03]): which one and, for an HTTP tool, the service it called (never its data or secrets).
  tool: "herramienta",
  requested: "pedida",
  error: "error",
  method: "método",
  host: "servidor",
  status: "respuesta",
  durationMs: "milisegundos",
  // A report table downloaded ([SEG-10], src/app/(app)/informes/actions.ts).
  table: "tabla",
  firstDay: "desde",
  lastDay: "hasta",
  channelFiltered: "solo un canal",
  // Contact data rights ([CTO-06], [CTO-07]): numbers only, never who the customer was.
  conversations: "conversaciones",
  messages: "mensajes",
  files: "archivos",
  bookingsAnonymized: "citas anonimizadas",
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
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

export function targetLabel(targetType: string | null): string | null {
  if (!targetType) return null;
  return TARGET_LABELS[targetType] ?? targetType;
}

function valueText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "sí" : "no";
  if (isRole(value)) return ROLE_LABELS[value];
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value) && value.every((item) => typeof item === "string" || typeof item === "number")) return value.join(", ");
  return null;
}

/** «clave: valor» lines of the (already secret-stripped) details; nested objects are left out. */
export function detailLines(details: Record<string, unknown>): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(details)) {
    const text = valueText(value);
    if (text !== null && text !== "") lines.push(`${DETAIL_LABELS[key] ?? key}: ${text}`);
  }
  return lines;
}
