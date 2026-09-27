// Spanish names for what the activity log records. Unknown actions (added by later phases) show their code.
import type { AuditActorType } from "@/lib/enums";
import { isRole, ROLE_LABELS } from "@/lib/permissions";

export const ACTOR_TYPE_LABELS: Record<AuditActorType, string> = { user: "Persona", ai: "IA", system: "Sistema" };

/** URL value of each actor type (?quien=…). */
export const ACTOR_TYPE_PARAMS: Record<AuditActorType, string> = { user: "persona", ai: "ia", system: "sistema" };

const ACTION_LABELS: Record<string, string> = {
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
  "settings.business_updated": "Cambió los ajustes del negocio",
  "settings.integrations_updated": "Cambió la IA o el correo del sistema",
  "settings.require_2fa_changed": "Cambió la exigencia de verificación en dos pasos",
  "settings.test_email_sent": "Envió un correo de prueba",
  "job.retried": "Reintentó un trabajo en segundo plano",
  "job.cancelled": "Canceló un trabajo en segundo plano",
  "channel.connected": "Conectó un canal",
  "channel.created": "Creó un canal",
  "channel.updated": "Cambió los ajustes de un canal",
  "channel.configured": "Cambió el aspecto o la configuración de un chat web",
  "channel.agent_changed": "Cambió el agente activo de un canal",
  "channel.members_changed": "Cambió quién atiende un canal",
  "channel.deleted": "Borró un canal",
  "contact.created": "Creó un contacto",
  "contact.updated": "Editó un contacto",
  "conversation.ai_changed": "Cambió la IA de una conversación",
  "conversation.handed_off": "Pasó una conversación a una persona",
  "conversation.status_changed": "Cambió el estado de una conversación",
  "conversation.assigned": "Asignó una conversación",
  "conversation.agent_changed": "Eligió otro agente para una conversación",
  "message.draft_approved": "Aprobó un borrador de la IA",
  "message.draft_discarded": "Descartó un borrador de la IA",
  "simulator.message_sent": "Envió un mensaje con el simulador",
  "tool.used": "Usó una herramienta",
  "retention.cleanup": "Borró datos caducados",
};

const TARGET_LABELS: Record<string, string> = {
  user: "Usuario",
  invitation: "Invitación",
  business_settings: "Ajustes del negocio",
  integration_settings: "Ajustes de IA y correo",
  system_email: "Correo del sistema",
  job: "Trabajo",
  channel: "Canal",
  conversation: "Conversación",
  contact: "Contacto",
  agent: "Agente",
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
