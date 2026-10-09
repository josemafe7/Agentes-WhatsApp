// What e2e/support/create-assistant-fixtures.ts leaves in the e2e database for «Cargar más» in «Asistentes»
// ([INT-10]): more conversations than fit in the list, and one with more messages than are shown at once. They belong
// to the demo admin, whose conversations no other test opens.
import type { RoleKey } from "./users";

export const ASSISTANT_HISTORY = {
  person: "admin" satisfies RoleKey,
  /** More than the 50 listed at a time (docs/pantallas.md «Conversación con un asistente»). */
  conversations: 53,
  /** The newest conversation: the one with more than the 200 messages shown at a time. */
  longConversation: "Conversación larga e2e",
  messages: 204,
  /** 1 is the oldest of the short ones. */
  title: (index: number) => `Pregunta antigua e2e ${index}`,
  /** 1 is the first message of the long conversation. */
  message: (index: number) => `Mensaje e2e ${index}.`,
} as const;
