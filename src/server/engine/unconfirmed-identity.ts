// A conversation whose identity the app made and nobody confirmed yet ([WA-63]: a first WhatsApp to the phone of the
// contact; [AGD-24]: an answer to a reminder of the system mail): in case the phone or the address belonged to
// someone else, the AI may only act on the booking of the reminder answered. It cannot see other bookings, save the
// contact's data or give them a baja, and offers a person for the rest, as with an email nobody vouched for
// ([COR-25]). A person confirms it from the conversation. System code.
import "server-only";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { contactIdentities, messages } from "@/db/schema";
import type { ChannelType } from "@/lib/enums";
import type { AgentRunConfig } from "@/server/ai/run-agent";

/**
 * Off for the turn: they would save data of a contact the customer may not be, or act beyond the reminder's booking.
 * «Dar de baja» stays ([HER-16]): whoever has that phone or that address may always stop the messages to it.
 */
const UNCONFIRMED_BLOCKED_TOOLS = ["guardar_datos_contacto", "crear_cita", "anotar_permiso_avisos"] as const;
/** Also off when there is no reminder to answer: they act on the contact's bookings. */
const BOOKING_TOOLS = ["ver_citas_del_cliente", "cancelar_cita", "reprogramar_cita"] as const;

/** What the agent is told (in «Qué no puedes hacer» of its instructions). */
export function unconfirmedIdentityNote(bookingId: string | null): string {
  const scope = bookingId
    ? `Solo puedes atender la cita del recordatorio al que responde (cita_id ${bookingId}): no puedes consultar otras citas`
    : "No puedes consultar, cambiar ni cancelar citas";
  return `Este cliente aún no está confirmado: la app le escribió a un teléfono o a un correo que alguien del equipo todavía no ha confirmado que sea suyo. ${scope}, crear citas nuevas ni guardar sus datos. Si te pide algo de eso, explícale con amabilidad que por seguridad lo gestiona una persona del equipo y ofrécele pasarle con ella (transferir_a_humano). Puedes responder a sus preguntas generales y, si te pide que no le escribáis más, darle de baja.`;
}

/**
 * Whether the conversation's contact has an identity of this channel type «sin confirmar», and the booking of the
 * newest reminder sent in it (null when none).
 */
export async function unconfirmedIdentityTurn(conversation: { id: string; contactId: string | null }, channel: { type: ChannelType }): Promise<{ bookingId: string | null } | null> {
  if (!conversation.contactId) return null;
  const [unconfirmed] = await db
    .select({ id: contactIdentities.id })
    .from(contactIdentities)
    .where(and(eq(contactIdentities.contactId, conversation.contactId), eq(contactIdentities.channelType, channel.type), isNotNull(contactIdentities.unconfirmedSince)))
    .limit(1);
  if (!unconfirmed) return null;
  // The reminder sent in the conversation (WhatsApp, Telegram, a mailbox's thread) or the one of the system mail an email answers.
  const recent = await db.select({ metadata: messages.metadata }).from(messages).where(eq(messages.conversationId, conversation.id)).orderBy(desc(messages.createdAt)).limit(50);
  const bookingOf = (value: unknown) => (typeof value === "object" && value !== null && typeof (value as { bookingId?: unknown }).bookingId === "string" ? (value as { bookingId: string }).bookingId : null);
  const bookingId = recent.map((row) => bookingOf(row.metadata.bookingReminder) ?? bookingOf(row.metadata.answersReminder)).find(Boolean) ?? null;
  return { bookingId };
}

/** The agent of this turn without the tools that do not fit, and told why and what to do instead. */
export function withUnconfirmedIdentityLimits(agent: AgentRunConfig, bookingId: string | null): AgentRunConfig {
  const blocked: readonly string[] = bookingId ? UNCONFIRMED_BLOCKED_TOOLS : [...UNCONFIRMED_BLOCKED_TOOLS, ...BOOKING_TOOLS];
  return {
    ...agent,
    systemTools: agent.systemTools.filter((tool) => !blocked.includes(tool)),
    blockedTools: [...(agent.blockedTools ?? []), ...blocked],
    instructions: { ...agent.instructions, cannot: [agent.instructions.cannot?.trim(), unconfirmedIdentityNote(bookingId)].filter(Boolean).join("\n\n") },
  };
}
