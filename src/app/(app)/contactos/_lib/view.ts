// How Contactos shows a contact ([CTO-02], [CTO-08], [CUM-13]): its name, an identity's phone (data, never a key,
// [CAN-13]), the conversation states of DESIGN.md, its consents in words and the bajas still in force. Server
// components only: the display name comes from src/data/contacts.ts, which also checks it when a contact is erased.
import { CircleCheck, CircleDot, Hand, type LucideIcon } from "lucide-react";
import type { ConsentState, OptOutScope } from "@/lib/consents";
import type { ChannelKind, ConsentType, ConversationStatus } from "@/lib/enums";

export { contactDisplayName } from "@/data/contacts";

/** Identities keep the phone as digits only ([WA-39]): shown with its «+». */
export function identityPhone(phone: string | null): string | null {
  if (!phone) return null;
  return /^\d+$/.test(phone) ? `+${phone}` : phone;
}

/** Conversation states of DESIGN.md: token, icon and text. */
export const CONVERSATION_STATUS_VIEW: Record<ConversationStatus, { label: string; icon: LucideIcon; className: string }> = {
  open: { label: "Abierta", icon: CircleDot, className: "bg-info-soft text-info" },
  pending_human: { label: "Pendiente de humano", icon: Hand, className: "bg-warning-soft text-warning" },
  resolved: { label: "Resuelta", icon: CircleCheck, className: "bg-success-soft text-success" },
};

export const CONSENT_TYPE_LABELS: Record<ConsentType, string> = {
  legal_acceptance: "Aceptó los textos legales",
  opt_out: "Baja",
  opt_in: "Alta",
  marketing_opt_out: "Baja de novedades y publicidad",
  marketing_opt_in: "Alta de novedades y publicidad",
  reminders_granted: "Dio permiso de avisos de sus citas",
  reminders_withdrawn: "Retiró el permiso de avisos de sus citas",
  marketing_granted: "Dio permiso de novedades y publicidad",
  marketing_withdrawn: "Retiró el permiso de novedades y publicidad",
  marketing_resumed: "Reanudó la publicidad desde WhatsApp (la baja sigue)",
};

/** Where a consent came from, in words ([CUM-13]); an unknown one shows as it is. */
const SOURCE_LABELS: Record<string, string> = {
  keyword: "Escribió «BAJA» o «STOP»",
  widget: "Chat web",
  person: "Lo anotó una persona",
  ai: "Lo anotó la IA en la conversación",
  import: "Importación",
  bulk: "Marcado a varios a la vez",
  merge: "Fusión de contactos",
  template_button: "Botón de baja de una plantilla",
  whatsapp_app: "Desde la app de WhatsApp",
  meta_131050: "WhatsApp rechazó un envío de publicidad",
  telegram_button: "Botón de Telegram",
  email_link: "Enlace de baja de un correo",
};

export function consentSourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

export type ActiveOptOut = { kind: ChannelKind; scope: OptOutScope; since: Date };

/** The bajas in force, newest first ([CTO-08]): of everything, or only of novedades y publicidad, on each kind. */
export function activeOptOuts(state: ConsentState): ActiveOptOut[] {
  const found: ActiveOptOut[] = [];
  for (const [kind, scopes] of Object.entries(state.optOuts) as [ChannelKind, ConsentState["optOuts"][ChannelKind]][]) {
    if (scopes.all) found.push({ kind, scope: "all", since: scopes.all.createdAt });
    else if (scopes.marketing) found.push({ kind, scope: "marketing", since: scopes.marketing.createdAt });
  }
  return found.sort((a, b) => b.since.getTime() - a.since.getTime());
}
