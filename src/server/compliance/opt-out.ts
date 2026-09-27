// Bajas ([CUM-03], [CUM-04], [CUM-13], [CTO-08]): a customer whose whole message is «BAJA» or «STOP» (any case, accents,
// punctuation or emoji) opts out of that channel. The opt-out goes into their consents with its date and channel, the
// ingest pipeline queues ONE confirmation instead of an AI reply, and from then on only a person reaches them there —
// the AI stays quiet, an AI draft cannot be approved and what the platform sends on its own (reminders, templates,
// notices) is kept as not sent (src/server/outbound/send.ts); the inbox warns whoever writes to them — until a person
// lifts it (src/data/consents.ts). The newest opt-out or opt-in of the contact in the channel decides. In email, the
// keyword is the first line of the body alone (no subject, no quoted history), and the contact is the sender of the
// email. System code (no actor).
import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { writeAudit } from "@/data/audit";
import { db, type Executor } from "@/db";
import { consents, type MessageError } from "@/db/schema";
import type { ChannelType, MessageContentType } from "@/lib/enums";
import { getJobQueue, type EnqueueResult, type JobQueue } from "@/server/adapters/job-queue";
import { ConflictError } from "@/server/errors";

const KEYWORDS = { baja: "BAJA", stop: "STOP" } as const;
type OptOutKeyword = (typeof KEYWORDS)[keyof typeof KEYWORDS];
/** Longer than this, a message is never just the keyword (a cheap guard before normalizing text from outside). */
const MAX_KEYWORD_MESSAGE = 64;

/** The keyword when the whole message is «BAJA» or «STOP»: case, accents, punctuation, symbols and emoji do not count. */
export function optOutKeywordOf(text: string | null | undefined): OptOutKeyword | null {
  if (!text || text.length > MAX_KEYWORD_MESSAGE) return null;
  const bare = text
    .normalize("NFKD")
    .replace(/[\p{M}\p{P}\p{S}\p{Cf}]/gu, "")
    .trim()
    .toLowerCase();
  return bare === "baja" || bare === "stop" ? KEYWORDS[bare] : null;
}

export function isOptOutKeyword(text: string | null | undefined): boolean {
  return optOutKeywordOf(text) !== null;
}

/**
 * What of an email may be the keyword: the first line of its body alone. The app keeps the email without its quoted
 * history and signature and, on the first email of a thread, with an «Asunto: …» line on top (src/server/channels/
 * email/ingest.ts): that line is not the customer's words, and a sign-off under «BAJA» does not hide it.
 */
export function emailOptOutText(text: string | null | undefined, subject: string | null | undefined): string | null {
  if (!text) return null;
  const subjectLine = subject ? `Asunto: ${subject}` : null;
  const body = subjectLine && (text === subjectLine || text.startsWith(`${subjectLine}\n`)) ? text.slice(subjectLine.length) : text;
  for (const line of body.split(/\r?\n/)) if (line.trim()) return line.trim();
  return null;
}

/** What the customer gets, once, when they opt out. */
export const OPT_OUT_CONFIRMATION_TEXT =
  "Listo: te hemos dado de baja y no te enviaremos más mensajes por este canal. Si quieres volver a recibirlos, escríbenos y una persona del equipo te atenderá.";
/** Why it does not go out ([CUM-03]): under what was not sent, and when approving an AI draft is refused. */
export const OPTED_OUT_SEND_ERROR =
  "El cliente se ha dado de baja en este canal: no le llega nada de la IA ni lo que la app envía sola (recordatorios, plantillas y avisos). Una persona sí puede escribirle.";
/** Over the composer of a conversation whose customer opted out of its channel ([CUM-03], [CUM-04]). */
export const OPTED_OUT_COMPOSER_WARNING = "Este cliente se ha dado de baja en este canal: la IA, los recordatorios y las plantillas están parados.";
export const OPTED_OUT_MESSAGE_ERROR: MessageError = { code: "opted_out", message: OPTED_OUT_SEND_ERROR };

/** Approving an AI draft for a customer who opted out of the channel: refused (the words are the AI's), nothing sent. */
export class OptedOutError extends ConflictError {
  constructor() {
    super(OPTED_OUT_SEND_ERROR);
  }
}

export type OptChoice = { id: string; type: "opt_out" | "opt_in"; createdAt: Date };

/** The contact's newest opt-out or opt-in in the channel, or null. */
export async function latestOptChoice(contactId: string, channelId: string, executor: Executor = db): Promise<OptChoice | null> {
  const [latest] = await executor
    .select({ id: consents.id, type: consents.type, createdAt: consents.createdAt })
    .from(consents)
    .where(and(eq(consents.contactId, contactId), eq(consents.channelId, channelId), inArray(consents.type, ["opt_out", "opt_in"])))
    .orderBy(desc(consents.createdAt))
    .limit(1);
  return latest && latest.type !== "legal_acceptance" ? { id: latest.id, type: latest.type, createdAt: latest.createdAt } : null;
}

/** Whether the contact opted out of the channel and nobody lifted it since ([CUM-03]). */
export async function isOptedOut(contactId: string | null | undefined, channelId: string, executor: Executor = db): Promise<boolean> {
  if (!contactId) return false;
  return (await latestOptChoice(contactId, channelId, executor))?.type === "opt_out";
}

export type KeywordOptOut = { consentId: string; conversationId: string };

export type KeywordOptOutInput = {
  channel: { id: string; type: ChannelType };
  /** The sender of this very message (in email, not always the conversation's contact). */
  contactId: string;
  conversationId: string;
  contentType: MessageContentType;
  text: string | null | undefined;
  /** An email's subject, to tell its «Asunto: …» line apart from the body. */
  subject?: string | null;
  now: Date;
};

/**
 * Inside the ingest transaction, for a customer's message: «BAJA» or «STOP» opts them out of the channel, with its date
 * and channel in their consents and a line in the activity log (no personal data). Null when it is not an opt-out or
 * they already were opted out (no second confirmation, [CUM-04]).
 */
export async function recordKeywordOptOut(tx: Executor, input: KeywordOptOutInput): Promise<KeywordOptOut | null> {
  const text = input.channel.type.startsWith("email_") ? emailOptOutText(input.text, input.subject) : input.text;
  const keyword = input.contentType === "text" ? optOutKeywordOf(text) : null;
  if (!keyword || (await isOptedOut(input.contactId, input.channel.id, tx))) return null;
  const [row] = await tx
    .insert(consents)
    .values({
      contactId: input.contactId,
      channelId: input.channel.id,
      channelType: input.channel.type,
      type: "opt_out",
      source: "keyword",
      note: keyword,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returning({ id: consents.id });
  await writeAudit(
    { actor: "system", action: "consent.opted_out", targetType: "contact", targetId: input.contactId, metadata: { channelId: input.channel.id, source: "keyword" } },
    tx,
  );
  return { consentId: row.id, conversationId: input.conversationId };
}

// ─── The confirmation, through the queue ─────────────────────────────────────────────────────────────────

export const OPT_OUT_CONFIRMATION_JOB = "compliance.opt_out_confirmation";
export const optOutConfirmationPayload = z.object({ consentId: z.uuid(), conversationId: z.uuid() });
export type OptOutConfirmationPayload = z.infer<typeof optOutConfirmationPayload>;

/** Queues the one confirmation of an opt-out, due now (src/server/compliance/opt-out-confirmation.ts sends it). */
export function enqueueOptOutConfirmation(optOut: KeywordOptOut, options: { now?: Date; queue?: JobQueue } = {}): Promise<EnqueueResult> {
  const payload: OptOutConfirmationPayload = { consentId: optOut.consentId, conversationId: optOut.conversationId };
  return (options.queue ?? getJobQueue()).enqueue({
    type: OPT_OUT_CONFIRMATION_JOB,
    payload,
    runAt: options.now,
    dedupeKey: `opt_out_confirmation:${optOut.consentId}`,
    maxAttempts: 3,
  });
}
