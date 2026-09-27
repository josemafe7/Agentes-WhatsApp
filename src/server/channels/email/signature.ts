// The AI's emails end with a signature and the AI notice ([COR-21], [CUM-01]): the channel's signature (or the
// business name) after the «-- » separator (RFC 3676), and one line saying an AI wrote it, and whether a person
// reviewed it. Only the AI's messages get it: a person's reply is theirs as they wrote it. Pure.
import "server-only";

export const AI_NOTICE_AUTOMATIC = "Este correo lo ha escrito un asistente de inteligencia artificial.";
export const AI_NOTICE_REVIEWED = "Este correo lo ha escrito un asistente de inteligencia artificial y lo ha revisado una persona.";

export type SignatureInput = {
  /** Who wrote the message. */
  senderType: string;
  /** A person approved (or edited) the AI's draft. */
  reviewed: boolean;
  /** The channel's signature ([COR-21]); the business name when empty. */
  signature: string | null | undefined;
  businessName: string | null | undefined;
};

export function withEmailSignature(text: string, input: SignatureInput): string {
  if (input.senderType !== "ai") return text;
  const signature = (input.signature?.trim() || input.businessName?.trim() || "").replace(/\r\n?/g, "\n");
  const notice = input.reviewed ? AI_NOTICE_REVIEWED : AI_NOTICE_AUTOMATIC;
  const body = text.trimEnd();
  return `${body}\n\n-- \n${signature ? `${signature}\n` : ""}${notice}`;
}
