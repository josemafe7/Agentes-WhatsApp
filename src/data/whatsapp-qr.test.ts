import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { appKv, auditLog, channels, contactIdentities, contacts, conversations, jobs, messages, notifications, rateLimits, realtimeEvents, whatsappQrKeys } from "@/db/schema";
import type { Role } from "@/lib/enums";
import { isLinked, loadQrCreds } from "@/server/channels/whatsapp-qr/auth-store";
import { readWhatsAppQrConfig } from "@/server/channels/whatsapp-qr/config";
import { setQrSupervisorForTests } from "@/server/channels/whatsapp-qr/runtime";
import { createQrSupervisor } from "@/server/channels/whatsapp-qr/supervisor";
import { AuthError, ConflictError, NotFoundError, RateLimitError } from "@/server/errors";
import { actorFor, createAgentRow, createBusiness, createChannel, createContactWithIdentity, createConversation } from "@/test/factories";
import { fakeQrSockets, QR_TEST } from "@/test/fixtures/whatsapp-qr";
import { deleteChannel, getChannel, listChannels, updateChannel } from "./channels";
import { runConnectionTest } from "./diagnostics-connections";
import { connectWhatsAppChannel } from "./whatsapp";
import { disconnectWhatsAppQr, getQrLinkState, getWhatsAppQrPanel, reconnectWhatsAppQr, startQrLink, whatsappQrAvailability } from "./whatsapp-qr";
import { getWhatsAppInboxState } from "./whatsapp-send";

const owner = actorFor("owner");
const NOT_MANAGERS: Role[] = ["supervisor", "agent", "viewer"];

const form = (overrides: Record<string, unknown> = {}) => ({ name: "WhatsApp por QR", riskAccepted: true, ...overrides });

function harness() {
  const fake = fakeQrSockets();
  const supervisor = createQrSupervisor({ openSocket: fake.openSocket, delay: () => ({ cancel: () => undefined }), tickAt: () => undefined });
  setQrSupervisorForTests(supervisor);
  return { ...fake, supervisor };
}

type Harness = ReturnType<typeof harness>;

/** The person starts the link and scans the code: the session opens. */
async function link(h: Harness, overrides: Record<string, unknown> = {}): Promise<string> {
  const { channelId } = await startQrLink(owner, form(overrides));
  h.latest().showQr();
  h.latest().scanned();
  await h.supervisor.sessionOf(channelId)?.idle();
  h.latest().open();
  await h.supervisor.sessionOf(channelId)?.idle();
  return channelId;
}

const row = async (channelId: string) => (await db.select().from(channels).where(eq(channels.id, channelId)))[0];

beforeEach(async () => {
  for (const table of [messages, conversations, contactIdentities, contacts, notifications, jobs, appKv, rateLimits, auditLog, realtimeEvents, whatsappQrKeys]) await db.delete(table);
  await db.delete(channels);
  await createBusiness();
});
afterEach(() => {
  setQrSupervisorForTests(null);
  vi.unstubAllEnvs();
});

describe("«Generar código QR» [QR-01] [QR-02] [QR-03] [WA-56]", () => {
  it("nothing is created until the risk notice is accepted, and only owner and admin may", async () => {
    harness();
    await expect(startQrLink(owner, form({ riskAccepted: false }))).rejects.toMatchObject({ fieldErrors: { riskAccepted: ["Marca la casilla para seguir."] } });
    await expect(startQrLink(owner, { name: "Sin casilla" })).rejects.toMatchObject({ fieldErrors: { riskAccepted: expect.any(Array) } });
    await expect(startQrLink(owner, form({ name: "" }))).rejects.toMatchObject({ fieldErrors: { name: expect.any(Array) } });
    await expect(startQrLink(owner, form({ activeAgentId: crypto.randomUUID() }))).rejects.toMatchObject({ fieldErrors: { activeAgentId: ["Ese agente no existe."] } });
    for (const role of NOT_MANAGERS) await expect(startQrLink(actorFor(role), form())).rejects.toThrow(AuthError);
    expect(await db.select().from(channels)).toHaveLength(0);
  });

  it("where the app cannot keep a connection open (Vercel) it says so and creates nothing", async () => {
    const h = harness();
    vi.stubEnv("VERCEL", "1");
    expect(whatsappQrAvailability(owner)).toMatchObject({ available: false, reason: expect.stringMatching(/Vercel/) });
    await expect(startQrLink(owner, form())).rejects.toThrow(/siempre encendida/);
    expect(h.sockets).toHaveLength(0);
    vi.unstubAllEnvs();
    expect(whatsappQrAvailability(owner)).toEqual({ available: true, reason: null });
    expect(await db.select().from(channels)).toHaveLength(0);
  });

  it("stores the channel in test mode with nobody in its list and shows the code, only as its image and only to who manages channels", async () => {
    const h = harness();
    const agent = await createAgentRow();
    const { channelId } = await startQrLink(owner, form({ activeAgentId: agent.id }));
    const channel = await row(channelId);
    expect(channel).toMatchObject({ type: "whatsapp", connectionMode: "qr", status: "connecting", testMode: true, testAllowlist: [], activeAgentId: agent.id, phoneNumberId: null });
    expect(readWhatsAppQrConfig(channel.config).qrRiskAcceptedAt).toBeTruthy();
    expect(await getQrLinkState(owner, channelId)).toMatchObject({ state: "starting", qr: null, number: null });

    h.latest().showQr("https://wa.me/settings/linked_devices#SECRETO-DEL-CODIGO");
    await h.supervisor.sessionOf(channelId)?.idle();
    const state = await getQrLinkState(owner, channelId);
    expect(state.state).toBe("pairing");
    expect(state.qr).toMatch(/^data:image\/png;base64,/);
    // The text of the code never travels as such.
    expect(JSON.stringify(state)).not.toContain("SECRETO-DEL-CODIGO");
    await expect(getQrLinkState(actorFor("viewer"), channelId)).rejects.toThrow(AuthError);
    expect((await db.select().from(auditLog)).map((entry) => entry.action)).toEqual(["channel.qr_link_started"]);
  });

  it("scanned: the channel is connected, its card says the way and the inbox offers neither templates nor a 24 h window [WA-54] [WA-55]", async () => {
    const h = harness();
    const channelId = await link(h);
    expect(await getQrLinkState(owner, channelId)).toMatchObject({ state: "open", qr: null, status: "connected", number: `+${QR_TEST.self.digits}`, accountName: QR_TEST.self.name });
    expect(await listChannels(owner)).toMatchObject([{ whatsappVia: "qr", whatsappNumber: `+${QR_TEST.self.digits}`, testMode: true, capabilities: { templates: false, window24h: false, audio: true, images: true, documents: true } }]);
    const { contact } = await createContactWithIdentity("whatsapp", { externalId: QR_TEST.customer.lid });
    const conversation = await createConversation(channelId, contact.id, { lastInboundAt: new Date(Date.now() - 3 * 86_400_000) });
    expect(await getWhatsAppInboxState(owner, conversation.id)).toBeNull();
    // What is Meta's own never applies to a number linked this way.
    await expect(connectWhatsAppChannel(owner, { channelId, name: "x", accessToken: "x".repeat(30), phoneNumberId: "200000000000001" })).rejects.toThrow(NotFoundError);
  });

  it("each person has a limit of links started: WhatsApp does not like insistence [SEG-07]", async () => {
    harness();
    for (let attempt = 0; attempt < 10; attempt++) await startQrLink(owner, form({ name: `Intento ${attempt}` }));
    await expect(startQrLink(owner, form())).rejects.toThrow(RateLimitError);
  });
});

describe("the panel [QR-10] [QR-11]", () => {
  it("shows the session as it is now, and never to who may not see channels", async () => {
    const h = harness();
    const channelId = await link(h);
    const panel = await getWhatsAppQrPanel(owner, channelId);
    expect(panel).toMatchObject({ displayPhoneNumber: `+${QR_TEST.self.digits}`, accountName: QR_TEST.self.name, session: "open", hasSession: true, unsupported: null });
    expect(panel.health.checks.map((check) => [check.key, check.status])).toEqual([["session", "ok"], ["process", "ok"], ["last_message", "off"]]);
    expect(JSON.stringify(panel)).not.toMatch(/noiseKey|signedIdentityKey/);
    expect((await getWhatsAppQrPanel(actorFor("viewer"), channelId)).session).toBe("open");
    await expect(getWhatsAppQrPanel(actorFor("agent"), channelId)).rejects.toThrow(AuthError);
    // The diagnostics test of the channel is the same lights ([AJU-11]).
    expect(await runConnectionTest(owner, { target: "channel", channelId })).toMatchObject({ ok: true, summary: expect.stringMatching(/sesión de WhatsApp está abierta/) });

    // A process that holds no session (the app has just restarted and could not open it) says so.
    setQrSupervisorForTests(null);
    const lost = await getWhatsAppQrPanel(owner, channelId);
    expect(lost).toMatchObject({ session: "none", hasSession: true });
    expect(lost.health.checks[0]).toMatchObject({ key: "session", status: "error" });
    expect(await runConnectionTest(owner, { target: "channel", channelId })).toMatchObject({ ok: false });
  });

  it("«Reconectar» opens again a session that is still linked; one that is gone needs a new code", async () => {
    const h = harness();
    const channelId = await link(h);
    h.latest().close(440);
    await h.supervisor.sessionOf(channelId)?.idle();
    expect((await getWhatsAppQrPanel(owner, channelId)).session).toBe("replaced");
    const sockets = h.sockets.length;
    await reconnectWhatsAppQr(owner, channelId);
    expect(h.sockets).toHaveLength(sockets + 1);
    h.latest().open();
    await h.supervisor.sessionOf(channelId)?.idle();
    expect((await row(channelId)).status).toBe("connected");

    // The phone closes the session: only «Volver a vincular» (the wizard, with this channel) brings it back.
    h.latest().close(401);
    await h.supervisor.sessionOf(channelId)?.idle();
    await expect(reconnectWhatsAppQr(owner, channelId)).rejects.toThrow(ConflictError);
    expect((await getChannel(owner, channelId)).hasSecrets).toBe(false);
    const again = await startQrLink(owner, form({ channelId, name: "WhatsApp por QR" }));
    expect(again.channelId).toBe(channelId);
    expect(await db.select().from(channels)).toHaveLength(1);
    h.latest().scanned();
    await h.supervisor.sessionOf(channelId)?.idle();
    h.latest().open();
    await h.supervisor.sessionOf(channelId)?.idle();
    expect(await row(channelId)).toMatchObject({ status: "connected", phoneNumberId: `qr:${QR_TEST.self.digits}` });
  });

  it("a disabled channel closes its connection and stays linked; switched on again, it opens by itself [CAN-16]", async () => {
    const h = harness();
    const channelId = await link(h);
    const socket = h.latest();
    await updateChannel(owner, channelId, { enabled: false });
    expect(socket.ended).toBe(true);
    expect(socket.loggedOut).toBe(false);
    expect(h.supervisor.status(channelId)).toBeNull();
    expect(isLinked(loadQrCreds(await row(channelId)))).toBe(true);
    await expect(reconnectWhatsAppQr(owner, channelId)).rejects.toThrow(/desactivado/);

    await updateChannel(owner, channelId, { enabled: true });
    expect(h.latest()).not.toBe(socket);
    h.latest().open();
    await h.supervisor.sessionOf(channelId)?.idle();
    expect((await row(channelId)).status).toBe("connected");
  });
});

describe("«Desconectar» [QR-12]", () => {
  it("closes the session in WhatsApp, erases its keys and leaves the channel disabled with its history", async () => {
    const h = harness();
    const channelId = await link(h);
    const socket = h.latest();
    expect(await disconnectWhatsAppQr(owner, channelId)).toEqual({ warning: null });
    expect(socket.loggedOut).toBe(true);
    expect(await row(channelId)).toMatchObject({ status: "disabled", secretsEnc: null, connectionMode: "qr", phoneNumberId: `qr:${QR_TEST.self.digits}` });
    expect(await db.select().from(whatsappQrKeys)).toHaveLength(0);
    // «Activar» does not bring it back: it has to be linked again ([WA-28]).
    await expect(updateChannel(owner, channelId, { enabled: true })).rejects.toThrow(ConflictError);
    expect((await db.select().from(auditLog)).map((entry) => entry.action)).toContain("channel.disconnected");
    for (const role of NOT_MANAGERS) await expect(disconnectWhatsAppQr(actorFor(role), channelId)).rejects.toThrow(AuthError);
  });

  it("without an open connection WhatsApp cannot be told: the session is erased here and the person is told to remove it on the phone", async () => {
    const h = harness();
    const channelId = await link(h);
    h.latest().close(428);
    await h.supervisor.sessionOf(channelId)?.idle();
    expect((await disconnectWhatsAppQr(owner, channelId)).warning).toMatch(/Dispositivos vinculados/);
    expect((await row(channelId)).secretsEnc).toBeNull();
  });

  it("deleting a channel without conversations takes its keys with it and leaves the phone's linked devices", async () => {
    const h = harness();
    const channelId = await link(h);
    await db.insert(whatsappQrKeys).values({ channelId, type: "session", keyId: "x", valueEnc: "v1:a:b:c" });
    const socket = h.latest();
    await deleteChannel(owner, channelId);
    expect(await db.select().from(channels)).toHaveLength(0);
    expect(await db.select().from(whatsappQrKeys)).toHaveLength(0);
    expect(socket.loggedOut).toBe(true);
    // Another kind of channel is never touched by this way's functions.
    const meta = await createChannel({ type: "whatsapp", connectionMode: "manual", phoneNumberId: "200000000000009" });
    await expect(getWhatsAppQrPanel(owner, meta.id)).rejects.toThrow(NotFoundError);
  });
});
