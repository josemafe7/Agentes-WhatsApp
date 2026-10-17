// [CAN-09] The raw webhook is saved before anything is done with it: an echo that fails ([IG-06]) still leaves it, with
// the error, and never drops the customer's messages of the same notice. The echo is made to fail here.
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { channels, contactIdentities, contacts, conversations, jobs, messages, realtimeEvents, webhookEvents } from "@/db/schema";
import { createAgentRow, createBusiness, createChannel } from "@/test/factories";
import { echoMessage, IG_TEST, instagramWebhook, signedBody, textMessage } from "@/test/fixtures/instagram";
import { encryptInstagramSecrets } from "./config";
import { processInstagramWebhook } from "./webhook";

vi.mock("./echo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./echo")>()),
  runInstagramEcho: async () => {
    throw new Error("Fallo de prueba al guardar el eco.");
  },
}));

const T0 = new Date("2026-10-16T08:00:05Z");

beforeEach(async () => {
  for (const table of [messages, conversations, contactIdentities, contacts, webhookEvents, jobs, realtimeEvents]) await db.delete(table);
  await db.delete(channels);
  await createBusiness();
});

describe("Instagram webhook order [CAN-09]", () => {
  it("an echo that fails still leaves the raw webhook, with the error, and the customer's message goes in [CAN-09] [IG-06]", async () => {
    const agent = await createAgentRow({ name: "Recepción" });
    const channel = await createChannel({
      type: "instagram",
      status: "connected",
      activeAgentId: agent.id,
      config: { accountId: IG_TEST.accountId },
      secretsEnc: encryptInstagramSecrets({ accessToken: IG_TEST.accessToken, appSecret: IG_TEST.appSecret, metaAppSecret: null, verifyToken: IG_TEST.verifyToken }),
    });
    const signed = signedBody(instagramWebhook([echoMessage({ text: "Te atiendo yo" }, { mid: "m-eco" }), textMessage("Vale, gracias", { mid: "m-cliente" })]));
    const result = await processInstagramWebhook(channel.id, signed.raw, signed.signature, { now: T0 });
    expect(result.status).toBe(200);
    const [raw] = await db.select().from(webhookEvents);
    expect(raw).toMatchObject({ source: "instagram", channelId: channel.id, signatureValid: true });
    expect(JSON.stringify(raw.payload)).toContain("m-eco");
    expect(raw.processedAt).not.toBeNull();
    expect(raw.error).toMatch(/Fallo de prueba al guardar el eco/);
    const [message] = await db.select().from(messages).where(eq(messages.externalId, "m-cliente"));
    expect(message).toMatchObject({ direction: "inbound", text: "Vale, gracias" });
  });
});
