// [BAN-16] [MOT-15]: a person switches the AI of a conversation on again and the customer's message left unanswered is
// answered right after, not at the next round of the queue: the action runs the queue once the reply is due.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { contactIdentities, contacts, conversations, jobs, messages, userRoles } from "@/db/schema";
import type { Actor } from "@/lib/permissions";
import { createBusiness, createChannel, createContactWithIdentity, createConversation, createMessage, createUser, type TestUser } from "@/test/factories";

const state = vi.hoisted(() => ({ actor: null as Actor | null }));

vi.mock("@/server/session", async () => {
  const { AuthError } = await import("@/server/errors");
  const { can } = await import("@/lib/permissions");
  const requireActor = async () => {
    if (!state.actor) throw new AuthError("unauthenticated");
    return state.actor;
  };
  return {
    requireActor,
    requirePermission: async (action: Parameters<typeof can>[1]) => {
      const actor = await requireActor();
      if (!can(actor, action)) throw new AuthError("forbidden");
      return actor;
    },
  };
});
vi.mock("next/cache", () => ({ refresh: () => undefined, revalidatePath: () => undefined }));
vi.mock("@/server/inbound/ingest", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/server/inbound/ingest")>()), kickTick: vi.fn() }));

import { REPLY_JOB } from "@/server/engine/schedule";
import { kickTick } from "@/server/inbound/ingest";
import { eq } from "drizzle-orm";
import { setAiAction } from "./actions";

let owner: TestUser;
let channelId: string;

beforeAll(async () => {
  await createBusiness();
  await db.delete(userRoles);
  channelId = (await createChannel({ name: "Web" })).id;
  owner = await createUser("owner");
});

beforeEach(async () => {
  for (const table of [jobs, messages, conversations, contactIdentities, contacts]) await db.delete(table);
  vi.mocked(kickTick).mockClear();
  state.actor = owner.actor;
});

async function conversationWaitingForAPerson() {
  const { contact } = await createContactWithIdentity("webchat", { name: "Ana" });
  const conversation = await createConversation(channelId, contact.id, { aiMode: "human", pauseReason: "IA apagada" });
  await createMessage(conversation, { text: "¿Seguís abiertos?" });
  return conversation;
}

describe("switching the AI on again [BAN-16]", () => {
  it("runs the queue right after answering, when the reply is due", async () => {
    const conversation = await conversationWaitingForAPerson();
    expect(await setAiAction({ conversationId: conversation.id, mode: "on" })).toEqual({ ok: true });
    const [job] = await db.select().from(jobs).where(eq(jobs.type, REPLY_JOB));
    expect(kickTick).toHaveBeenCalledTimes(1);
    expect(kickTick).toHaveBeenCalledWith({ maxDurationSec: 60, runAt: job.runAt });
  });

  it("nothing to answer, or the AI switched off: nothing to run", async () => {
    const conversation = await conversationWaitingForAPerson();
    expect(await setAiAction({ conversationId: conversation.id, mode: "off" })).toEqual({ ok: true });
    await db.update(messages).set({ direction: "outbound", senderType: "human", status: "sent" }).where(eq(messages.conversationId, conversation.id));
    expect(await setAiAction({ conversationId: conversation.id, mode: "on" })).toEqual({ ok: true });
    expect(kickTick).not.toHaveBeenCalled();
  });
});
