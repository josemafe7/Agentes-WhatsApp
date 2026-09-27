// Whether the AI may answer now ([MOT-03], [CAN-03], [CAN-06], [CAN-08], [CAN-16], [WA-43], [CUM-04], [TRA-02],
// [BAN-11], [AGE-14]), in the spec's order. Pure: the reply engine loads the data. If any check fails the AI stays
// quiet and the message waits for a person in the inbox.
import type { ChannelType } from "@/lib/enums";
import type { ChannelRecord } from "@/server/channels/types";

export const WINDOW_24H_MS = 24 * 60 * 60_000;

export type ReplySkipReason =
  | "channel_disabled"
  | "no_agent"
  | "ai_disabled"
  | "human_mode"
  | "paused"
  | "test_mode"
  | "window_closed"
  | "opted_out"
  | "off_hours"
  | "ai_not_configured"
  | "nothing_pending";

export type ReplyCheckInput = {
  channel: Pick<ChannelRecord, "status" | "activeAgentId" | "aiEnabled" | "testMode" | "testAllowlist" | "offHoursBehavior">;
  conversation: { status: string; aiMode: string; aiPausedUntil: Date | null; agentOverrideId: string | null; lastInboundAt: Date | null };
  /** The channel keeps the 24 h customer service window ([WA-43]). */
  window24h: boolean;
  /** What the channel vouches for about the sender, for the test-mode list ([CAN-06]): see testModeIdentifiers. */
  identifiers: readonly (string | null | undefined)[];
  /** The contact's latest consent in this channel is an opt-out ([CUM-03], [CUM-04]). */
  optedOut: boolean;
  withinBusinessHours: boolean;
  now: Date;
};

export type ReplyCheckResult = { ok: true; agentId: string; pauseExpired: boolean } | { ok: false; reason: ReplySkipReason };

const PHONE_LIKE = /^[+\d][\d\s().-]*$/;

/** Allowlist entries and identities compare without case, spaces, «+» or dashes in numbers. */
export function normalizeIdentifier(value: string): string {
  const trimmed = value.trim().toLowerCase();
  return PHONE_LIKE.test(trimmed) ? trimmed.replace(/\D/g, "") : trimmed;
}

/** Channel types whose identity phone comes from the channel itself (WhatsApp's wa_id), not from what someone typed. */
const CHANNEL_GIVES_PHONE: ReadonlySet<ChannelType> = new Set(["whatsapp"]);

/**
 * What the test-mode list is compared with ([CAN-06]): only what the channel vouches for about the sender (the web
 * chat's visitor id, the email address, the WhatsApp BSUID or wa_id and the phone Meta gives). Never the contact's
 * phone or email, nor a phone the visitor typed in the web chat form: a stranger could type the owner's.
 */
export function testModeIdentifiers(channelType: ChannelType, identities: readonly { externalId: string; phone: string | null }[]): string[] {
  return identities.flatMap((identity) => [identity.externalId, ...(CHANNEL_GIVES_PHONE.has(channelType) && identity.phone ? [identity.phone] : [])]);
}

export function isAllowlisted(allowlist: readonly string[], identifiers: readonly (string | null | undefined)[]): boolean {
  const allowed = new Set(allowlist.map(normalizeIdentifier).filter(Boolean));
  return identifiers.some((value) => value && allowed.has(normalizeIdentifier(value)));
}

export function evaluateReplyChecks(input: ReplyCheckInput): ReplyCheckResult {
  const { channel, conversation, now } = input;
  // A disabled channel neither answers nor sends ([CAN-16]).
  if (channel.status === "disabled") return { ok: false, reason: "channel_disabled" };
  // The conversation's own agent wins over the channel's ([AGE-14]); none = only people answer ([CAN-03]).
  const agentId = conversation.agentOverrideId ?? channel.activeAgentId;
  if (!agentId) return { ok: false, reason: "no_agent" };
  if (!channel.aiEnabled) return { ok: false, reason: "ai_disabled" };
  if (conversation.status === "pending_human" || conversation.aiMode !== "ai") return { ok: false, reason: "human_mode" };
  const pauseExpired = conversation.aiPausedUntil !== null && conversation.aiPausedUntil.getTime() <= now.getTime();
  if (conversation.aiPausedUntil !== null && !pauseExpired) return { ok: false, reason: "paused" };
  if (channel.testMode && !isAllowlisted(channel.testAllowlist, input.identifiers)) return { ok: false, reason: "test_mode" };
  if (input.window24h && (!conversation.lastInboundAt || now.getTime() - conversation.lastInboundAt.getTime() > WINDOW_24H_MS)) {
    return { ok: false, reason: "window_closed" };
  }
  if (input.optedOut) return { ok: false, reason: "opted_out" };
  if (!input.withinBusinessHours && channel.offHoursBehavior === "no_reply") return { ok: false, reason: "off_hours" };
  return { ok: true, agentId, pauseExpired };
}
