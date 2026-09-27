// Counters of an email channel's panel ([COR-14], [CAN-01]): the emails received, the ones sent and the drafts waiting
// for a person. «Canales: ver» (owner, admin, Solo lectura). The ignored ones, by reason, come with the channel's view
// (getEmailChannelView, [COR-16]).
import "server-only";
import { and, count, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { messages } from "@/db/schema";
import type { MessageStatus } from "@/lib/enums";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import { EMAIL_CHANNEL_TYPES } from "@/server/channels/email/config";
import { loadEmailChannel } from "./email";
import { assertCan } from "./guard";

/** What left the mailbox, whatever the provider said afterwards. */
const SENT_STATUSES: MessageStatus[] = ["sent", "delivered", "read", "played"];

export type EmailChannelCounters = {
  /** Customers' emails (each email once: its attachments are separate messages). */
  received: number;
  /** Replies that left the mailbox: the AI's, the team's from the inbox and people's from their email program. */
  sent: number;
  /** AI replies waiting for a person to approve, edit or discard ([COR-14]). */
  draftsPending: number;
};

export async function getEmailChannelCounters(actor: Actor, channelId: unknown): Promise<EmailChannelCounters> {
  assertCan(actor, PERMISSIONS.channels.view);
  const channel = await loadEmailChannel(channelId, EMAIL_CHANNEL_TYPES, { allowDemo: true });
  // A real mailbox only counts real mail; a demo one only ever gets the simulator's ([ARR-11]).
  const scope = and(eq(messages.channelId, channel.id), ...(channel.isDemo ? [] : [eq(messages.simulated, false)]));
  const rows = await db
    .select({ direction: messages.direction, status: messages.status, contentType: messages.contentType, n: count() })
    .from(messages)
    .where(and(scope, inArray(messages.status, ["received", "draft", ...SENT_STATUSES])))
    .groupBy(messages.direction, messages.status, messages.contentType);
  const counters: EmailChannelCounters = { received: 0, sent: 0, draftsPending: 0 };
  for (const row of rows) {
    if (row.direction === "inbound" && row.contentType === "text") counters.received += row.n;
    else if (row.direction === "outbound" && row.status === "draft") counters.draftsPending += row.n;
    else if (row.direction === "outbound" && SENT_STATUSES.includes(row.status)) counters.sent += row.n;
  }
  return counters;
}
