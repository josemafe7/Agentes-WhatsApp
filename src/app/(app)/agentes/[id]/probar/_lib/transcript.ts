// «Probar agente» keeps its conversation only in the browser ([PRU-01], [PRU-05], [PRU-06]): every send carries the
// transcript and the server checks it again (./input.ts). Pure: shared by the page and the Server Action.

export const TEST_CHAT_LIMITS = {
  /** Messages sent with each turn: the prompt only uses the last 20 anyway (DEFAULT_HISTORY_MESSAGES). */
  maxMessages: 20,
  /** Characters of one message; the tester types at most this and longer past replies are cut before sending. */
  maxMessageChars: 4_000,
} as const;

/** One message of the test conversation: the tester plays the customer, the agent answers. */
export type TranscriptMessage = { role: "contact" | "ai"; text: string };

/** What the browser sends: the last messages, each cut to the limit. */
export function capTranscript(messages: readonly TranscriptMessage[]): TranscriptMessage[] {
  return messages
    .slice(-TEST_CHAT_LIMITS.maxMessages)
    .map((message) => ({ role: message.role, text: message.text.slice(0, TEST_CHAT_LIMITS.maxMessageChars) }));
}
