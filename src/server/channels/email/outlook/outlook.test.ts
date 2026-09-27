// Outlook / Microsoft 365 end to end against a fake Graph and Microsoft login ([COR-07], [COR-08], [COR-14], [COR-15],
// [COR-20], [COR-22], [CAN-11]).
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { channels, conversations, messages, notifications } from "@/db/schema";
import { registerChannelAdapter } from "@/server/channels/registry";
import { sendDraft, sendOutbound } from "@/server/outbound/send";
import { createAgentRow, createBusiness, createChannel, createUser } from "@/test/factories";
import { memoryFileStorage } from "@/test/fixtures/whatsapp/memory-storage";
import { createEmailAdapter, outlookAdapter } from "../adapter";
import { encryptOAuthSecrets, readEmailConfig, readOAuthSecrets } from "../config";
import { runEmailPoll } from "../jobs";
import { buildRawEmail, fakeMicrosoft } from "../test-helpers";
import { outlookProvider, secretExpiryCheck } from "./provider";

const OWN = "hola@negocio.test";
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

async function setup(options: { replyMode?: "auto" | "draft"; accessExpiresAt?: Date; secretExpiresAt?: Date; syncedSince?: string | null } = {}) {
  await createBusiness();
  const owner = await createUser("owner");
  const agent = await createAgentRow();
  const fake = fakeMicrosoft({ mail: OWN });
  const channel = await createChannel({
    type: "email_outlook",
    name: "Outlook",
    status: "connected",
    replyMode: options.replyMode ?? "auto",
    activeAgentId: agent.id,
    config: {
      emailAddress: OWN,
      grantedScopes: ["https://graph.microsoft.com/Mail.ReadWrite", "https://graph.microsoft.com/Mail.Send", "https://graph.microsoft.com/User.Read"],
      outlook: {
        clientId: "11111111-2222-3333-4444-555555555555",
        tenant: "common",
        userId: "user-1",
        syncedSince: options.syncedSince === undefined ? "2026-09-27T08:00:00.000Z" : options.syncedSince,
        clientSecretExpiresAt: (options.secretExpiresAt ?? new Date(Date.now() + 400 * DAY)).toISOString(),
      },
    },
    secretsEnc: encryptOAuthSecrets({ clientSecret: "secreto-entra", refreshToken: "rt-0", accessToken: "eyJ.valid", accessExpiresAt: options.accessExpiresAt ?? new Date(Date.now() + HOUR) }),
  });
  const deps = { ...fake.deps, storage: memoryFileStorage().storage };
  registerChannelAdapter(createEmailAdapter(outlookProvider, deps));
  return { fake, channel, agent, deps, owner };
}

const conversationsOf = (channelId: string) => db.select().from(conversations).where(eq(conversations.channelId, channelId));
const messagesOf = (channelId: string) => db.select().from(messages).where(eq(messages.channelId, channelId));
const poll = (channelId: string, deps: ReturnType<typeof fakeMicrosoft>["deps"]) => runEmailPoll(channelId, {}, deps);

async function loadChannel(id: string) {
  const [row] = await db.select().from(channels).where(eq(channels.id, id));
  return row;
}

describe("Outlook: recepción por consulta delta ([COR-08])", () => {
  afterEach(() => registerChannelAdapter(outlookAdapter));

  it("lee la bandeja de entrada, sigue el hilo por conversationId y usa el cuerpo sin citas", async () => {
    const { fake, channel, deps } = await setup();
    fake.addMessage("inbox", await buildRawEmail({ to: OWN, subject: "Cita", text: "¿El jueves?\n\nEl lun, Peluquería escribió:\n> Hola", messageId: "<o1@cliente.test>" }), { conversationId: "conv-A", uniqueBody: "¿El jueves por la tarde?" });
    const outcome = await poll(channel.id, deps);
    expect(outcome).toMatchObject({ kind: "polled", report: { ingested: 1 } });
    const [conversation] = await conversationsOf(channel.id);
    expect(conversation.externalThreadId).toBe("conv-A");
    const [message] = await messagesOf(channel.id);
    expect(message.text).toBe("Asunto: Cita\n\n¿El jueves por la tarde?");
    const inbox = fake.calls.find((call) => call.url.pathname.endsWith("/inbox/messages/delta"));
    expect(inbox?.headers.get("prefer")).toContain('IdType="ImmutableId"');
    expect(readEmailConfig((await loadChannel(channel.id)).config).outlook.inboxDeltaLink).toContain("deltatoken=inbox-1");
    // The same item again is not stored twice ([CAN-11]).
    fake.state.cursor.inbox = 0;
    await poll(channel.id, deps);
    expect(await messagesOf(channel.id)).toHaveLength(1);
  });

  it("410 Gone: vuelve a sincronizar desde cero sin duplicar", async () => {
    const { fake, channel, deps } = await setup();
    fake.addMessage("inbox", await buildRawEmail({ to: OWN }));
    await poll(channel.id, deps);
    fake.state.deltaGone = true;
    fake.state.cursor.inbox = 0;
    fake.addMessage("inbox", await buildRawEmail({ to: OWN, from: "luis@cliente.test" }));
    const outcome = await poll(channel.id, deps);
    expect(outcome).toMatchObject({ report: { resynced: true, ingested: 1 } });
    expect(await messagesOf(channel.id)).toHaveLength(2);
  });

  it("[COR-20] una respuesta desde Outlook (elementos enviados) pausa la IA en esa conversación", async () => {
    const { fake, channel, deps } = await setup();
    fake.addMessage("inbox", await buildRawEmail({ to: OWN, messageId: "<o1@cliente.test>" }), { conversationId: "conv-B" });
    await poll(channel.id, deps);
    fake.addMessage("sentitems", await buildRawEmail({ from: OWN, to: "ana@cliente.test", text: "Lo miro y te digo.", inReplyTo: "<o1@cliente.test>" }), { conversationId: "conv-B" });
    const outcome = await poll(channel.id, deps);
    expect(outcome).toMatchObject({ report: { humanReplies: 1 } });
    const [conversation] = await conversationsOf(channel.id);
    expect(conversation.pauseReason).toBe("Ha respondido una persona desde el buzón");
  });
});

describe("Outlook: envío ([COR-08], [COR-14], [COR-15], [COR-18])", () => {
  afterEach(() => registerChannelAdapter(outlookAdapter));

  it("createReply con nuestra cabecera → PATCH con el texto → send; lo enviado no cuenta como respuesta de una persona", async () => {
    const { fake, channel, agent, deps } = await setup();
    const original = fake.addMessage("inbox", await buildRawEmail({ to: OWN }), { conversationId: "conv-C" });
    await poll(channel.id, deps);
    const [conversation] = await conversationsOf(channel.id);
    const sent = await sendOutbound({ conversationId: conversation.id, sender: { type: "ai", agentId: agent.id, agentName: agent.name }, text: "Hola Ana", retryDelayMs: 0 });
    expect(sent.status).toBe("sent");
    expect(fake.state.created).toHaveLength(1);
    expect(fake.state.created[0]).toMatchObject({ replyTo: original.id, headers: [{ name: "X-DominIA-Agente", value: "1" }] });
    const draftId = fake.state.created[0].id;
    expect(fake.state.patched[0]).toMatchObject({ id: draftId, body: { body: { contentType: "Text" } } });
    expect(JSON.stringify(fake.state.patched[0].body)).toContain("Hola Ana");
    expect(fake.state.sentDrafts).toEqual([draftId]);
    const [row] = await db.select().from(messages).where(eq(messages.id, sent.messageId));
    expect(row.externalId).toBe(draftId);
    // The sent copy keeps the immutable id: it is recognized as ours.
    fake.addMessage("sentitems", await buildRawEmail({ from: OWN, to: "ana@cliente.test" }), { id: draftId, conversationId: "conv-C" });
    await poll(channel.id, deps);
    expect((await conversationsOf(channel.id))[0].aiPausedUntil).toBeNull();
  });

  it("si Graph no acepta nuestra cabecera al crear la respuesta, se crea sin ella", async () => {
    const { fake, channel, agent, deps } = await setup();
    fake.addMessage("inbox", await buildRawEmail({ to: OWN }));
    await poll(channel.id, deps);
    fake.state.rejectHeaders = true;
    const [conversation] = await conversationsOf(channel.id);
    const sent = await sendOutbound({ conversationId: conversation.id, sender: { type: "ai", agentId: agent.id, agentName: agent.name }, text: "Hola", retryDelayMs: 0 });
    expect(sent.status).toBe("sent");
    expect(fake.state.created[0].headers).toBeNull();
  });

  it("[COR-14] [COR-15] en modo borrador el borrador de createReply queda en Outlook y al aprobarlo se envía ese mismo", async () => {
    const { fake, channel, agent, deps } = await setup({ replyMode: "draft" });
    fake.addMessage("inbox", await buildRawEmail({ to: OWN }), { conversationId: "conv-D" });
    await poll(channel.id, deps);
    const [conversation] = await conversationsOf(channel.id);
    const draft = await sendOutbound({ conversationId: conversation.id, sender: { type: "ai", agentId: agent.id, agentName: agent.name }, text: "Borrador de la IA", draft: true });
    await poll(channel.id, deps);
    expect(fake.state.created).toHaveLength(1);
    expect(fake.state.sentDrafts).toEqual([]);
    const draftId = fake.state.created[0].id;
    const approved = await sendDraft(draft.messageId, { text: "Texto editado", approvedBy: { userId: "u", name: "Marta" }, retryDelayMs: 0 });
    expect(approved.status).toBe("sent");
    expect(fake.state.created).toHaveLength(1);
    expect(fake.state.sentDrafts).toEqual([draftId]);
    expect(JSON.stringify(fake.state.patched.at(-1)?.body)).toContain("Texto editado");
    expect(readEmailConfig((await loadChannel(channel.id)).config).mailboxDrafts).toEqual({});
  });
});

describe("Outlook: acceso y Client Secret ([COR-07], [COR-22])", () => {
  afterEach(() => registerChannelAdapter(outlookAdapter));

  it("al renovar el token se guarda el refresh token nuevo", async () => {
    const { fake, channel, deps } = await setup({ accessExpiresAt: new Date(Date.now() - HOUR) });
    await poll(channel.id, deps);
    expect(readOAuthSecrets(await loadChannel(channel.id))?.refreshToken).toBe(fake.state.refreshTokens[0]);
  });

  it("AADSTS7000222 (secreto caducado) deja el canal en «Requiere reconexión» con el motivo", async () => {
    const { fake, channel, deps, owner } = await setup({ accessExpiresAt: new Date(Date.now() - HOUR) });
    fake.state.tokenError = { error: "invalid_client", codes: [7000222] };
    await expect(poll(channel.id, deps)).resolves.toMatchObject({ kind: "failed", reconnect: true });
    const row = await loadChannel(channel.id);
    expect(row.status).toBe("error");
    expect(readEmailConfig(row.config).reconnect?.reason).toMatch(/Client Secret de Microsoft ha caducado/);
    expect(await db.select().from(notifications).where(and(eq(notifications.channelId, channel.id), eq(notifications.userId, owner.userId)))).toHaveLength(1);
  });

  it("avisa una vez 30 días antes de que caduque el Client Secret", async () => {
    const { channel, deps, owner } = await setup({ secretExpiresAt: new Date(Date.now() + 10 * DAY) });
    await poll(channel.id, deps);
    await poll(channel.id, deps);
    const notices = await db.select().from(notifications).where(and(eq(notifications.channelId, channel.id), eq(notifications.userId, owner.userId)));
    expect(notices).toHaveLength(1);
    expect(notices[0].title).toContain("Client Secret caduca pronto");
    expect((await loadChannel(channel.id)).lastHealth?.checks.find((check) => check.key === "secret_expiry")?.status).toBe("warn");
  });

  it("con el Client Secret ya caducado no se llama a Microsoft: «Requiere reconexión»", async () => {
    const { fake, channel, deps } = await setup({ secretExpiresAt: new Date(Date.now() - DAY) });
    await expect(poll(channel.id, deps)).resolves.toMatchObject({ kind: "failed", reconnect: true });
    expect(fake.calls).toHaveLength(0);
  });

  it("la luz de la caducidad del secreto", () => {
    const now = new Date("2026-09-27T00:00:00Z");
    expect(secretExpiryCheck("2027-09-27T00:00:00.000Z", now)?.status).toBe("ok");
    expect(secretExpiryCheck("2026-10-20T00:00:00.000Z", now)?.status).toBe("warn");
    expect(secretExpiryCheck("2026-09-01T00:00:00.000Z", now)?.status).toBe("error");
    expect(secretExpiryCheck(null, now)).toBeNull();
  });
});
