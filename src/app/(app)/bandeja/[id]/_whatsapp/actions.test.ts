import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { messages, whatsappTemplates } from "@/db/schema";
import type { Actor } from "@/lib/permissions";
import { registerChannelAdapter } from "@/server/channels/registry";
import { createWhatsAppAdapter, whatsappAdapter } from "@/server/channels/whatsapp/adapter";
import { encryptWhatsAppSecrets } from "@/server/channels/whatsapp/config";
import { actorFor, createBusiness, createChannel, createContactWithIdentity, createConversation, createUser } from "@/test/factories";
import { WA_TEST } from "@/test/fixtures/whatsapp";
import { connectedNumberRoutes, FAKE_META_BASE_URL, fakeMetaFetch, metaJson, sendMessageResponse, templateComponents, type MetaCall } from "@/test/fixtures/whatsapp/fake-meta";

const state = vi.hoisted(() => ({ actor: null as Actor | null, refreshes: 0 }));

vi.mock("@/server/session", async () => {
  const { AuthError } = await import("@/server/errors");
  const { can } = await import("@/lib/permissions");
  return {
    requirePermission: async (action: Parameters<typeof can>[1]) => {
      if (!state.actor) throw new AuthError("unauthenticated");
      if (!can(state.actor, action)) throw new AuthError("forbidden");
      return state.actor;
    },
  };
});
vi.mock("next/cache", () => ({
  refresh: () => {
    state.refreshes++;
  },
}));

import { sendTemplateAction } from "./actions";

const VALUES = { nombre: "Ana", fecha: "3 de octubre", hora: "10:30" };
let metaCalls: MetaCall[] = [];
let input: { conversationId: string; templateId: string; values: Record<string, string> };
let channelId: string;

let templateId: string;

beforeAll(async () => {
  await createBusiness();
  const channel = await createChannel({
    type: "whatsapp",
    name: "WhatsApp Recepción",
    phoneNumberId: WA_TEST.phoneNumberId,
    wabaId: WA_TEST.wabaId,
    metaAppId: WA_TEST.appId,
    graphApiVersion: "v26.0",
    secretsEnc: encryptWhatsAppSecrets({ accessToken: WA_TEST.accessToken, appSecret: WA_TEST.appSecret, twoStepPin: null }),
  });
  channelId = channel.id;
  const [template] = await db
    .insert(whatsappTemplates)
    .values({ channelId, name: "recordatorio_cita", language: "es", category: "UTILITY", status: "APPROVED", components: templateComponents, variables: ["nombre", "fecha", "hora"] })
    .returning();
  templateId = template.id;
});

beforeEach(async () => {
  state.actor = null;
  state.refreshes = 0;
  // A customer whose last message was 30 h ago: only a template can reach them.
  const { contact } = await createContactWithIdentity("whatsapp", { phone: WA_TEST.customer.waId });
  const conversation = await createConversation(channelId, contact.id, { lastInboundAt: new Date(Date.now() - 30 * 3_600_000) });
  input = { conversationId: conversation.id, templateId, values: VALUES };
  const fake = fakeMetaFetch(connectedNumberRoutes({ [`POST /${WA_TEST.phoneNumberId}/messages`]: () => metaJson(sendMessageResponse(`wamid.ACTION_${crypto.randomUUID()}`)) }));
  metaCalls = fake.calls;
  registerChannelAdapter(createWhatsAppAdapter({ fetchImpl: fake.fetch, baseUrl: FAKE_META_BASE_URL, sleep: async () => {} }));
});

afterEach(() => registerChannelAdapter(whatsappAdapter));

const storedFor = (conversationId: string) => db.select().from(messages).where(eq(messages.conversationId, conversationId));

describe("sendTemplateAction [WA-43] [BAN-08] [PER-02] [PER-03]", () => {
  it("an agent of the channel sends the template: sent, AI paused and the screen refreshed", async () => {
    state.actor = (await createUser("agent", { channelIds: [channelId] })).actor;
    const result = await sendTemplateAction(input);
    expect(result).toMatchObject({ ok: true, data: { status: "sent", aiPausedUntil: expect.any(Date) } });
    expect(state.refreshes).toBe(1);
    expect(metaCalls.filter((call) => (call.body as { type?: string }).type === "template")).toHaveLength(1);
    expect(await storedFor(input.conversationId)).toHaveLength(1);
  });

  it("Solo lectura and an agent of another channel are refused, and nothing is sent", async () => {
    state.actor = actorFor("viewer");
    expect(await sendTemplateAction(input)).toEqual({ ok: false, error: "No tienes permiso para hacer esto." });
    state.actor = actorFor("agent", { channelIds: [crypto.randomUUID()] });
    expect(await sendTemplateAction(input)).toEqual({ ok: false, error: "No tienes permiso para hacer esto." });
    state.actor = null;
    expect(await sendTemplateAction(input)).toMatchObject({ ok: false });
    expect(metaCalls).toHaveLength(0);
    expect(await storedFor(input.conversationId)).toHaveLength(0);
    expect(state.refreshes).toBe(0);
  });

  it("invalid input and a missing value come back as errors to show, without sending", async () => {
    state.actor = (await createUser("supervisor")).actor;
    expect(await sendTemplateAction({ ...input, templateId: "x" })).toMatchObject({ ok: false, fieldErrors: { templateId: expect.any(Array) } });
    expect(await sendTemplateAction({ ...input, values: { nombre: "Ana" } })).toEqual({ ok: false, error: "Falta el dato «fecha» de la plantilla." });
    expect(metaCalls).toHaveLength(0);
  });
});
