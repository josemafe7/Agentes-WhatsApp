// Who wrote an email turn, and what the AI may do for them ([COR-25], [HER-04], [PER-08]). Anyone can write any From:
// only the receiving server's Authentication-Results vouches for it (src/server/channels/email/auth-results.ts), and a
// thread takes emails from anyone ([CAN-12]) while the agent's tools act on the conversation's contact. So a turn with
// an email the server did not vouch for, or written by someone who is not that contact, goes without the tools that
// read or change the contact's existing bookings or data; the AI can still answer general questions (and book a new
// appointment), and it is told to offer a person for the rest. Simulated messages (the owner's simulator) and demo
// mailboxes (they never read real mail) are exempt.
import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { contactIdentities, messages } from "@/db/schema";
import type { ChannelType } from "@/lib/enums";
import type { AgentRunConfig } from "@/server/ai/run-agent";
import { isEmailChannelType } from "@/server/channels/email/config";
import { readEmailMetadata } from "@/server/channels/email/metadata";

/** The tools that read or change what the contact already has: only for a sender who is surely that contact. */
export const SENDER_CHECKED_TOOLS = ["ver_citas_del_cliente", "cancelar_cita", "reprogramar_cita", "guardar_datos_contacto"] as const;

/** What the agent is told when those tools are off for the turn (in «Qué no puedes hacer» of its instructions). */
export const UNVERIFIED_SENDER_NOTE =
  "En esta respuesta no puedes consultar, cambiar ni cancelar las citas del cliente ni guardar sus datos: no se ha podido comprobar que este correo lo envía de verdad esa persona. Si te pide algo de eso, explícale con amabilidad que por seguridad lo gestiona una persona del equipo y ofrécele pasarle con ella (transferir_a_humano). Puedes responder a sus preguntas generales.";

/**
 * Whether the turn of an email conversation must go without SENDER_CHECKED_TOOLS: one of its customer emails was not
 * vouched for by the receiving server, or came from someone other than the conversation's contact.
 */
export async function isUncheckedEmailTurn(
  conversation: { contactId: string | null },
  channel: { type: ChannelType; isDemo: boolean },
  pendingIds: readonly string[],
): Promise<boolean> {
  const channelType = channel.type;
  if (!isEmailChannelType(channelType) || channel.isDemo || pendingIds.length === 0) return false;
  const rows = await db.select({ metadata: messages.metadata, simulated: messages.simulated }).from(messages).where(inArray(messages.id, [...pendingIds]));
  const senders = new Set<string>();
  for (const row of rows) {
    if (row.simulated) continue;
    const email = readEmailMetadata(row.metadata);
    const address = email?.from?.address?.trim().toLowerCase();
    if (email?.senderVerified !== true || !address) return true;
    senders.add(address);
  }
  if (senders.size === 0) return false;
  const identities = await db
    .select({ contactId: contactIdentities.contactId, externalId: contactIdentities.externalId })
    .from(contactIdentities)
    .where(and(eq(contactIdentities.channelType, channelType), inArray(contactIdentities.externalId, [...senders])));
  return [...senders].some((address) => identities.find((identity) => identity.externalId === address)?.contactId !== conversation.contactId);
}

/** The agent of this turn without SENDER_CHECKED_TOOLS, and told why and what to do instead. */
export function withoutSenderCheckedTools(agent: AgentRunConfig): AgentRunConfig {
  const blocked: readonly string[] = SENDER_CHECKED_TOOLS;
  return {
    ...agent,
    systemTools: agent.systemTools.filter((tool) => !blocked.includes(tool)),
    instructions: { ...agent.instructions, cannot: [agent.instructions.cannot?.trim(), UNVERIFIED_SENDER_NOTE].filter(Boolean).join("\n\n") },
  };
}
