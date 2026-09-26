import { describe, expect, it } from "vitest";
import { testChatInputSchema } from "./input";
import { capTranscript, TEST_CHAT_LIMITS, type TranscriptMessage } from "./transcript";

const AGENT_ID = "3f1c9f5e-0d4e-4f55-9a55-2d7f3f1c9f5e";

describe("«Probar agente» transcript limits [PRU-01] [SEG-05]", () => {
  it("sends only the last messages, each cut to the limit, and the result passes the server check", () => {
    const long: TranscriptMessage[] = Array.from({ length: TEST_CHAT_LIMITS.maxMessages + 5 }, (_, i) => ({
      role: i % 2 === 0 ? "contact" : "ai",
      text: i === TEST_CHAT_LIMITS.maxMessages + 3 ? "x".repeat(TEST_CHAT_LIMITS.maxMessageChars + 500) : `Mensaje ${i}`,
    }));
    const capped = capTranscript(long);
    expect(capped).toHaveLength(TEST_CHAT_LIMITS.maxMessages);
    expect(capped.at(-1)).toEqual({ role: "contact", text: `Mensaje ${TEST_CHAT_LIMITS.maxMessages + 4}` });
    expect(capped[0].text).toBe("Mensaje 5");
    expect(Math.max(...capped.map((message) => message.text.length))).toBe(TEST_CHAT_LIMITS.maxMessageChars);
    expect(testChatInputSchema.safeParse({ agentId: AGENT_ID, channel: "webchat", messages: capped }).success).toBe(true);
  });

  it("keeps a short transcript as it is", () => {
    const short: TranscriptMessage[] = [{ role: "contact", text: "Hola" }];
    expect(capTranscript(short)).toEqual(short);
  });

  it("the server check trims the messages and only accepts WhatsApp, correo or web [PRU-03]", () => {
    const parsed = testChatInputSchema.parse({ agentId: AGENT_ID, channel: "email", messages: [{ role: "contact", text: "  Hola  " }] });
    expect(parsed.messages).toEqual([{ role: "contact", text: "Hola" }]);
    for (const channel of ["whatsapp", "email", "webchat"]) {
      expect(testChatInputSchema.safeParse({ agentId: AGENT_ID, channel, messages: [{ role: "contact", text: "Hola" }] }).success).toBe(true);
    }
    expect(testChatInputSchema.safeParse({ agentId: AGENT_ID, channel: "test", messages: [{ role: "contact", text: "Hola" }] }).success).toBe(false);
  });
});
