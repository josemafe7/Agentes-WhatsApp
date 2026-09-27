import { describe, expect, it } from "vitest";
import { evaluateReplyChecks, isAllowlisted, normalizeIdentifier, testModeIdentifiers, WINDOW_24H_MS, type ReplyCheckInput } from "./checks";

const NOW = new Date("2026-09-30T09:00:00Z");
const AGENT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

type Overrides = { channel?: Partial<ReplyCheckInput["channel"]>; conversation?: Partial<ReplyCheckInput["conversation"]> } & Partial<
  Omit<ReplyCheckInput, "channel" | "conversation">
>;

function input(overrides: Overrides = {}): ReplyCheckInput {
  const { channel, conversation, ...rest } = overrides;
  return {
    channel: { status: "connected", activeAgentId: AGENT, aiEnabled: true, testMode: false, testAllowlist: [], offHoursBehavior: "reply", ...channel },
    conversation: { status: "open", aiMode: "ai", aiPausedUntil: null, agentOverrideId: null, lastInboundAt: NOW, ...conversation },
    window24h: false,
    identifiers: ["visitor-1"],
    optedOut: false,
    withinBusinessHours: true,
    now: NOW,
    ...rest,
  };
}

describe("the AI answers only when every check passes [MOT-03]", () => {
  it("everything right: the channel's active agent answers", () => {
    expect(evaluateReplyChecks(input())).toEqual({ ok: true, agentId: AGENT, pauseExpired: false });
  });

  it("the conversation's own agent wins over the channel's [AGE-14]", () => {
    expect(evaluateReplyChecks(input({ conversation: { agentOverrideId: OTHER } }))).toMatchObject({ ok: true, agentId: OTHER });
  });

  it("without an active agent only people answer [CAN-03]", () => {
    expect(evaluateReplyChecks(input({ channel: { activeAgentId: null } }))).toEqual({ ok: false, reason: "no_agent" });
  });

  it("with the channel's AI off, the AI does not answer [CAN-03]", () => {
    expect(evaluateReplyChecks(input({ channel: { aiEnabled: false } }))).toEqual({ ok: false, reason: "ai_disabled" });
  });

  it("a disabled channel does not answer [CAN-16]", () => {
    expect(evaluateReplyChecks(input({ channel: { status: "disabled" } }))).toEqual({ ok: false, reason: "channel_disabled" });
  });

  it("human mode and a pending hand-off stop the AI [TRA-02]", () => {
    expect(evaluateReplyChecks(input({ conversation: { aiMode: "human" } }))).toEqual({ ok: false, reason: "human_mode" });
    expect(evaluateReplyChecks(input({ conversation: { status: "pending_human" } }))).toEqual({ ok: false, reason: "human_mode" });
  });

  it("a pause stops it until it ends; then it comes back alone [BAN-11]", () => {
    expect(evaluateReplyChecks(input({ conversation: { aiPausedUntil: new Date(NOW.getTime() + 1) } }))).toEqual({ ok: false, reason: "paused" });
    expect(evaluateReplyChecks(input({ conversation: { aiPausedUntil: new Date(NOW.getTime() - 1) } }))).toEqual({
      ok: true,
      agentId: AGENT,
      pauseExpired: true,
    });
  });

  it("test mode answers only the contacts of its list [CAN-06]", () => {
    const channel = { testMode: true, testAllowlist: ["+34 600 111 222", "Ana@Example.com"] };
    expect(evaluateReplyChecks(input({ channel }))).toEqual({ ok: false, reason: "test_mode" });
    expect(evaluateReplyChecks(input({ channel, identifiers: ["34600111222"] })).ok).toBe(true);
    expect(evaluateReplyChecks(input({ channel, identifiers: [null, "ana@example.com"] })).ok).toBe(true);
  });

  it("outside the 24 h window the AI does not write [WA-43]", () => {
    const old = new Date(NOW.getTime() - WINDOW_24H_MS - 1);
    expect(evaluateReplyChecks(input({ window24h: true, conversation: { lastInboundAt: old } }))).toEqual({ ok: false, reason: "window_closed" });
    expect(evaluateReplyChecks(input({ window24h: false, conversation: { lastInboundAt: old } })).ok).toBe(true);
    expect(evaluateReplyChecks(input({ window24h: true })).ok).toBe(true);
  });

  it("an opted-out contact is left to a person [CUM-04]", () => {
    expect(evaluateReplyChecks(input({ optedOut: true }))).toEqual({ ok: false, reason: "opted_out" });
  });

  it("off hours: «No responder» waits for a person, «Responder igual» answers [CAN-08]", () => {
    expect(evaluateReplyChecks(input({ withinBusinessHours: false, channel: { offHoursBehavior: "no_reply" } }))).toEqual({
      ok: false,
      reason: "off_hours",
    });
    expect(evaluateReplyChecks(input({ withinBusinessHours: false })).ok).toBe(true);
  });
});

describe("identifiers the test-mode list is compared with [CAN-06]", () => {
  it("only what the channel vouches for: the identity, and the phone only when WhatsApp gives it", () => {
    const identities = [{ externalId: "visitor-1", phone: "34600111222" }];
    expect(testModeIdentifiers("webchat", identities)).toEqual(["visitor-1"]);
    expect(testModeIdentifiers("email_gmail", [{ externalId: "ana@example.com", phone: null }])).toEqual(["ana@example.com"]);
    expect(testModeIdentifiers("whatsapp", [{ externalId: "ES.123", phone: "34600111222" }])).toEqual(["ES.123", "34600111222"]);
  });
});

describe("test-mode list entries [CAN-06]", () => {
  it("compare numbers without spaces, «+» or dashes and emails without case", () => {
    expect(normalizeIdentifier(" +34 600-111-222 ")).toBe("34600111222");
    expect(normalizeIdentifier("Ana@Example.COM")).toBe("ana@example.com");
    expect(isAllowlisted(["600 111 222"], ["600111222"])).toBe(true);
    expect(isAllowlisted([], ["600111222"])).toBe(false);
  });
});
