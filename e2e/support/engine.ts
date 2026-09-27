// Waiting for the reply engine ([MOT-01], [MOT-15]) in the e2e run. A reply is scheduled REPLY_DEBOUNCE_MS after the
// customer's message and kicked by the request that stored it; these helpers also run the queue through the cron
// address while they wait, so a test never depends on that kick alone. The simulated OpenRouter records every call:
// `session_id` is the conversation, so a test counts only the calls of its own conversation.
import { expect, type APIRequestContext } from "@playwright/test";
import { chatRequests, type ChatRequestSent } from "./ai";
import { triggerTick } from "./app";
import { DEMO_URL, REPLY_DEBOUNCE_MS } from "./env";
import type { MockClient } from "./mock-client";

/** Enough for a reply to arrive: the wait, the model, sending it and a poll of the screen (web chat or inbox). */
export const REPLY_TIMEOUT_MS = 30_000;
/** Enough for a reply that must not come: the wait, the engine's turn and a margin. */
export const NO_REPLY_WINDOW_MS = REPLY_DEBOUNCE_MS + 6_000;

/** Runs the background queue now (the demo server has no local ticker under `next start`). */
export async function runQueue(request: APIRequestContext): Promise<void> {
  await triggerTick(request, DEMO_URL);
}

/** Polls `check` until it is true, running the queue before each look. */
export async function untilWithQueue(
  request: APIRequestContext,
  check: () => Promise<boolean>,
  message: string,
  timeout: number = REPLY_TIMEOUT_MS,
): Promise<void> {
  await expect
    .poll(
      async () => {
        await runQueue(request);
        return check();
      },
      { message, timeout, intervals: [500, 1_000, 2_000] },
    )
    .toBe(true);
}

/** `read()` keeps giving `expected` for `forMs` while the queue runs: nothing more arrives. */
export async function holdsFor<T>(
  request: APIRequestContext,
  read: () => Promise<T>,
  expected: T,
  message: string,
  forMs: number = NO_REPLY_WINDOW_MS,
): Promise<void> {
  const end = Date.now() + forMs;
  for (;;) {
    await runQueue(request);
    const value: unknown = await read();
    expect(value, message).toEqual(expected);
    if (Date.now() >= end) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

/** The chat calls the app made for one conversation (its id is the `session_id`, [MOT-08]). */
export async function chatRequestsFor(mock: MockClient, conversationId: string): Promise<ChatRequestSent[]> {
  return (await chatRequests(mock)).filter((request) => request.body.session_id === conversationId);
}
