// Bajas ([CUM-03], [CUM-04], [CUM-13], [CTO-08]): a customer whose whole message is «BAJA» or «STOP» (any case, accents,
// punctuation or emoji) opts out of that channel. The opt-out goes into their consents with its date and channel, the
// ingest pipeline queues ONE confirmation instead of an AI reply, and from then on nothing of the business reaches them
// there — the AI stays quiet, a person's message is refused with the reason and what the platform sends on its own is
// kept as not sent (src/server/outbound/send.ts) — until a person lifts it (src/data/consents.ts). The newest opt-out
// or opt-in of the contact in the channel decides. System code (no actor).
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

/** What the customer gets, once, when they opt out. */
export const OPT_OUT_CONFIRMATION_TEXT =
  "Listo: te hemos dado de baja y no te enviaremos más mensajes por este canal. Si quieres volver a recibirlos, escríbenos y una persona del equipo te atenderá.";
/** Why nothing goes out ([CUM-03]): a person reads it when their message is refused and under what was not sent. */
export const OPTED_OUT_SEND_ERROR = "El cliente se ha dado de baja en este canal: no se le envía nada hasta que una persona quite la baja en su ficha.";
export const OPTED_OUT_MESSAGE_ERROR: MessageError = { code: "opted_out", message: OPTED_OUT_SEND_ERROR };

/** A person's message to a customer who opted out of the channel: refused, and nothing is stored. */
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
  contactId: string;
  conversationId: string;
  contentType: MessageContentType;
  text: string | null | undefined;
  now: Date;
};

/**
 * Inside the ingest transaction, for a customer's message: «BAJA» or «STOP» opts them out of the channel, with its date
 * and channel in their consents and a line in the activity log (no personal data). Null when it is not an opt-out or
 * they already were opted out (no second confirmation, [CUM-04]).
 */
export async function recordKeywordOptOut(tx: Executor, input: KeywordOptOutInput): Promise<KeywordOptOut | null> {
  const keyword = input.contentType === "text" ? optOutKeywordOf(input.text) : null;
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
