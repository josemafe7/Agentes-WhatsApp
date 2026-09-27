// Who sees «Convertir en FAQ» and on which messages ([CON-22], [PER-01]). Pure: the page decides with it whether
// to show the action; the server checks again when the draft is read and when the FAQ is saved.
import type { MessageItem } from "@/data/messages";
import { can, PERMISSIONS, type Actor } from "@/lib/permissions";

/** Whoever may convert replies of the conversation's channel into FAQs and edit the knowledge (not Agente or Solo lectura). */
export function canConvertToFaq(actor: Actor, channelId: string): boolean {
  return can(actor, PERMISSIONS.inbox.convertFaq, { channelId }) && can(actor, PERMISSIONS.knowledge.manage);
}

/** Only a reply a person wrote to the customer, with text: the same rule as src/data/knowledge-faq.ts. */
export function isConvertibleReply(message: Pick<MessageItem, "senderType" | "direction" | "text">): boolean {
  return message.senderType === "human" && message.direction === "outbound" && Boolean(message.text?.trim());
}
