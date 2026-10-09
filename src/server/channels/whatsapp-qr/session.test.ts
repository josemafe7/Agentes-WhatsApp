import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { appKv, businessSettings, channels, contactIdentities, contacts, conversations, jobs, messages, notifications, realtimeEvents, whatsappQrKeys } from "@/db/schema";
import { REPLY_JOB } from "@/server/engine/schedule";
import { createAgentRow, createBusiness, createChannel, createContactWithIdentity, createConversation, createMessage, createUser } from "@/test/factories";
import { memoryFileStorage } from "@/test/fixtures/whatsapp/memory-storage";
import { fakeQrSockets, JPEG_BYTES, OGG_BYTES, QR_TEST, qrImage, qrText, qrVoice } from "@/test/fixtures/whatsapp-qr";
import { PHONE_PAUSE_REASON, PHONE_SENDER_NAME } from "../phone-echo";
import { getChannelAdapter } from "../registry";
import { ChannelSendError, type OutboundMessage } from "../types";
import { createWhatsAppQrAdapter, whatsappQrAdapter } from "./adapter";
import { createQrKeyStore, isLinked, loadQrCreds } from "./auth-store";
import { readWhatsAppQrConfig } from "./config";
import { POST } from "@/app/api/internal/whatsapp-qr/route";
import { QR_NOT_OPEN } from "./health";
import { askQrHost, performQrRequest, requestOfQrHost } from "./host";
import { isSafeDirectPath, WHATSAPP_MEDIA_HOST, type QrMediaFetcher } from "./media";
import { setQrSupervisorForTests } from "./runtime";
import { RECONNECT_BASE_MS } from "./session";
import { createQrSupervisor } from "./supervisor";

const T0 = new Date((QR_TEST.now + 5) * 1_000);

function harness(files: Record<string, Uint8Array> = {}) {
  const fake = fakeQrSockets();
  const delays: { run: () => void; ms: number; cancelled: boolean }[] = [];
  const ticks: (Date | null)[] = [];
  const memory = memoryFileStorage();
  const fetched: Parameters<QrMediaFetcher>[0][] = [];
  const fetchMedia: QrMediaFetcher = async (file) => {
    fetched.push(file);
    const bytes = files[file.kind] ?? OGG_BYTES;
    return (async function* () {
      yield bytes;
    })();
  };
  const supervisor = createQrSupervisor({
    openSocket: fake.openSocket,
    now: () => T0,
    delay: (run, ms) => {
      const entry = { run, ms, cancelled: false };
      delays.push(entry);
      return { cancel: () => void (entry.cancelled = true) };
    },
    tickAt: (runAt) => void ticks.push(runAt),
    media: { storage: memory.storage, fetchMedia },
    // A voice note would be transcribed next: no key in the test, so nothing is called.
  });
  setQrSupervisorForTests(supervisor);
  return { ...fake, supervisor, delays, ticks, memory, fetched };
}

type Harness = ReturnType<typeof harness>;

const newChannel = async (overrides: Partial<typeof channels.$inferInsert> = {}) => {
  const agent = await createAgentRow({ name: "Recepción" });
  return createChannel({ type: "whatsapp", connectionMode: "qr", name: "WhatsApp por QR", status: "connecting", activeAgentId: agent.id, ...overrides });
};

/** Links a new channel: the code is shown, scanned, and the session opens. */
async function linked(h: Harness, overrides: Partial<typeof channels.$inferInsert> = {}) {
  const channel = await newChannel(overrides);
  await h.supervisor.start(channel.id, { pairing: true });
  h.latest().showQr();
  h.latest().scanned();
  await h.supervisor.sessionOf(channel.id)?.idle();
  h.latest().open();
  await h.supervisor.sessionOf(channel.id)?.idle();
  return channel.id;
}

const idle = (h: Harness, channelId: string) => h.supervisor.sessionOf(channelId)?.idle();
const row = async (channelId: string) => (await db.select().from(channels).where(eq(channels.id, channelId)))[0];
const stored = (direction: "inbound" | "outbound") => db.select().from(messages).where(eq(messages.direction, direction));
const pendingJobs = (type: string) => db.select().from(jobs).where(and(eq(jobs.type, type), eq(jobs.status, "pending")));

beforeEach(async () => {
  for (const table of [messages, conversations, contactIdentities, contacts, jobs, notifications, realtimeEvents, appKv, whatsappQrKeys]) await db.delete(table);
  await db.delete(channels);
  await db.delete(businessSettings);
  await createBusiness();
});
afterEach(() => {
  setQrSupervisorForTests(null);
  vi.unstubAllEnvs();
});

describe("linking a number [QR-03] [QR-04]", () => {
  it("shows the code, and once scanned the channel is connected with its number, its name and its session stored encrypted", async () => {
    const h = harness();
    const channel = await newChannel();
    await h.supervisor.start(channel.id, { pairing: true });
    expect(h.sockets).toHaveLength(1);
    expect(h.supervisor.status(channel.id)).toMatchObject({ state: "starting", qr: null });

    h.latest().showQr("https://wa.me/settings/linked_devices#CODIGO-1");
    await idle(h, channel.id);
    expect(h.supervisor.status(channel.id)).toMatchObject({ state: "pairing", qr: "https://wa.me/settings/linked_devices#CODIGO-1" });
    // The code is a secret: never stored with the channel.
    expect(JSON.stringify(await row(channel.id))).not.toContain("CODIGO-1");

    // Scanned: WhatsApp closes on purpose and a new connection opens the linked session.
    h.latest().scanned();
    await idle(h, channel.id);
    expect(h.sockets).toHaveLength(2);
    expect(h.sockets[1].options.creds).toBe(h.sockets[0].options.creds);
    h.latest().open();
    await idle(h, channel.id);

    expect(h.supervisor.status(channel.id)).toMatchObject({ state: "open", qr: null, error: null });
    const after = await row(channel.id);
    expect(after).toMatchObject({ status: "connected", connectionMode: "qr", phoneNumberId: `qr:${QR_TEST.self.digits}`, displayPhoneNumber: `+${QR_TEST.self.digits}`, verifiedName: QR_TEST.self.name });
    expect(readWhatsAppQrConfig(after.config).qrLinkedAt).toBe(T0.toISOString());
    expect(after.lastHealth?.checks.map((check) => [check.key, check.status])).toEqual([["session", "ok"], ["process", "ok"], ["last_message", "off"]]);
    // The session is stored, and never in clear ([SEG-01]).
    expect(after.secretsEnc).toMatch(/^v1:/);
    expect(after.secretsEnc).not.toContain(QR_TEST.self.digits);
    expect(isLinked(loadQrCreds(after))).toBe(true);
    expect(getChannelAdapter(after)).toBe(whatsappQrAdapter);
  });

  it("a code nobody scans expires, and nothing reconnects by itself; asking again shows a new one", async () => {
    const h = harness();
    const channel = await newChannel();
    await h.supervisor.start(channel.id, { pairing: true });
    h.latest().showQr();
    h.latest().close(408);
    await idle(h, channel.id);
    expect(h.supervisor.status(channel.id)).toMatchObject({ state: "expired", qr: null, error: expect.stringMatching(/caducado/) });
    expect(h.delays).toHaveLength(0);
    // What the attempt left is not a session: nothing of it is kept.
    expect(await row(channel.id)).toMatchObject({ status: "connecting", secretsEnc: null });

    await h.supervisor.start(channel.id, { pairing: true });
    expect(h.sockets).toHaveLength(2);
    // A new attempt starts from new credentials.
    expect(h.sockets[1].options.creds).not.toBe(h.sockets[0].options.creds);
    // While a code is showing, asking again opens nothing else.
    await h.supervisor.start(channel.id, { pairing: true });
    expect(h.sockets).toHaveLength(2);
  });

  it("the same number cannot be linked twice, nor one that is connected another way [QR-05] [WA-11]", async () => {
    const h = harness();
    await createChannel({ type: "whatsapp", connectionMode: "ycloud", phoneNumberId: `ycloud:${QR_TEST.self.digits}`, name: "Ya por YCloud" });
    const channel = await newChannel();
    await h.supervisor.start(channel.id, { pairing: true });
    h.latest().scanned();
    await idle(h, channel.id);
    const socket = h.latest();
    socket.open();
    await idle(h, channel.id);
    expect(h.supervisor.status(channel.id)).toMatchObject({ state: "refused", error: expect.stringMatching(/ya está en otro canal/) });
    // The link just made is undone: WhatsApp is told and nothing of it is kept.
    expect(socket.loggedOut).toBe(true);
    expect(await row(channel.id)).toMatchObject({ status: "error", secretsEnc: null, phoneNumberId: null });
    expect(await db.select().from(whatsappQrKeys)).toHaveLength(0);
  });

  it("linking a channel again with another phone is refused: its conversations are one number's", async () => {
    const h = harness();
    const channelId = await linked(h);
    await h.supervisor.logout(channelId);
    await h.supervisor.start(channelId, { pairing: true });
    h.latest().scanned({ id: "34600999888:1@s.whatsapp.net", lid: "999888777666555:1@lid" });
    await idle(h, channelId);
    h.latest().open({ id: "34600999888:1@s.whatsapp.net", lid: "999888777666555:1@lid" });
    await idle(h, channelId);
    expect(h.supervisor.status(channelId)).toMatchObject({ state: "refused", error: expect.stringMatching(/otro número \(\+34600999888\)/) });
    expect((await row(channelId)).phoneNumberId).toBe(`qr:${QR_TEST.self.digits}`);
  });
});

describe("the session survives a restart [QR-04]", () => {
  it("a new process opens the linked numbers by themselves, without a code; the rest wait for a person", async () => {
    const first = harness();
    const channelId = await linked(first);
    const neverLinked = await newChannel({ name: "Sin vincular" });
    const disabled = await newChannel({ name: "Desactivado", status: "disabled", secretsEnc: (await row(channelId)).secretsEnc });

    // The app restarts: another supervisor, the same database.
    const second = harness();
    await second.supervisor.startAll();
    expect(second.sockets).toHaveLength(1);
    expect(isLinked(second.latest().options.creds)).toBe(true);
    second.latest().open();
    await idle(second, channelId);
    expect(second.supervisor.status(channelId)).toMatchObject({ state: "open" });
    expect(second.supervisor.status(neverLinked.id)).toBeNull();
    expect(second.supervisor.status(disabled.id)).toBeNull();
    // Opening again does not move the moment it was linked.
    expect(readWhatsAppQrConfig((await row(channelId)).config).qrLinkedAt).toBe(T0.toISOString());
    // Asked twice, there is still one connection per number.
    await second.supervisor.startAll();
    expect(second.sockets).toHaveLength(1);
  });

  it("the keys of the session are stored encrypted, one row each, and a batch is written or deleted as one", async () => {
    const channel = await newChannel();
    const store = createQrKeyStore(channel.id);
    await store.set({ "pre-key": { "1": { public: new Uint8Array([1, 2, 3]), private: new Uint8Array([4, 5, 6]) } }, session: { "34611222333.0": new Uint8Array([9, 9, 9]) }, "lid-mapping": { "34611222333": "111222333444555" } });
    const rows = await db.select().from(whatsappQrKeys);
    expect(rows).toHaveLength(3);
    for (const stored of rows) expect(stored.valueEnc).toMatch(/^v1:/);
    const session = await store.get("session", ["34611222333.0", "no-existe"]);
    expect(Object.keys(session)).toEqual(["34611222333.0"]);
    expect([...session["34611222333.0"]]).toEqual([9, 9, 9]);
    expect((await store.get("lid-mapping", ["34611222333"]))["34611222333"]).toBe("111222333444555");
    // A null value deletes its key; the others of the batch are written.
    await store.set({ session: { "34611222333.0": null }, "pre-key": { "2": { public: new Uint8Array([7]), private: new Uint8Array([8]) } } });
    expect(await store.get("session", ["34611222333.0"])).toEqual({});
    expect(Object.keys(await store.get("pre-key", ["1", "2"])).sort()).toEqual(["1", "2"]);
    // Another channel never reads these.
    expect(await createQrKeyStore((await newChannel()).id).get("pre-key", ["1", "2"])).toEqual({});
    await store.clear?.();
    expect(await db.select().from(whatsappQrKeys)).toHaveLength(0);
  });
});

describe("receiving [QR-06] [QR-07] [CAN-09]–[CAN-13]", () => {
  it("a customer's text: contact by its WhatsApp identity, message stored once and the reply scheduled, never the AI here", async () => {
    const h = harness();
    const channelId = await linked(h);
    const message = qrText("Hola, ¿tenéis hueco mañana?", { id: "3EB0PRIMERO" });
    h.latest().receive([message]);
    await idle(h, channelId);

    const [inbound] = await stored("inbound");
    expect(inbound).toMatchObject({ channelId, externalId: "3EB0PRIMERO", contentType: "text", text: "Hola, ¿tenéis hueco mañana?", senderType: "contact", status: "received" });
    const identities = await db.select().from(contactIdentities);
    expect(identities.map((identity) => identity.externalId).sort()).toEqual([QR_TEST.customer.lid, QR_TEST.customer.digits].sort());
    expect(await db.select().from(contacts)).toMatchObject([{ name: QR_TEST.customer.name, phone: QR_TEST.customer.digits }]);
    expect(await pendingJobs(REPLY_JOB)).toHaveLength(1);
    // There is no request to run the queue after: the session asks for it when the reply is due.
    expect(h.ticks).toHaveLength(1);
    expect(h.ticks[0]).toBeInstanceOf(Date);
    expect((await row(channelId)).lastInboundAt?.toISOString()).toBe(T0.toISOString());

    // The same message again (WhatsApp may deliver it twice) changes nothing ([CAN-11]).
    h.latest().receive([message]);
    await idle(h, channelId);
    expect(await stored("inbound")).toHaveLength(1);
  });

  it("what arrived while the app was off is read too, and what is older than the link never is", async () => {
    const h = harness();
    const channelId = await linked(h);
    h.latest().receive([qrText("Os escribí anoche", { id: "3EB0NOCHE" }), qrText("De la semana pasada", { id: "3EB0VIEJO", timestamp: QR_TEST.now - 7 * 86_400 })], "append");
    await idle(h, channelId);
    expect((await stored("inbound")).map((message) => message.externalId)).toEqual(["3EB0NOCHE"]);
  });

  it("groups, statuses and channels are never read", async () => {
    const h = harness();
    const channelId = await linked(h);
    h.latest().receive([qrText("Hola grupo", { remoteJid: "120363041234567890@g.us", remoteJidAlt: null, participant: QR_TEST.customer.lid }), qrText("Mi estado", { remoteJid: "status@broadcast", remoteJidAlt: null })]);
    await idle(h, channelId);
    expect(await db.select().from(messages)).toHaveLength(0);
    expect(await db.select().from(contacts)).toHaveLength(0);
    expect(h.ticks).toHaveLength(0);
  });

  it("a voice note and a photo are downloaded at once, only from WhatsApp's own host, and stored privately [MED-01]", async () => {
    const h = harness({ audio: OGG_BYTES, image: JPEG_BYTES });
    const channelId = await linked(h);
    h.latest().receive([qrVoice({ id: "3EB0VOZ" }), qrImage("Así lo quiero", { id: "3EB0FOTO" })]);
    await idle(h, channelId);
    const rows = await stored("inbound");
    const voice = rows.find((message) => message.externalId === "3EB0VOZ");
    const photo = rows.find((message) => message.externalId === "3EB0FOTO");
    expect(voice?.media).toMatchObject({ downloadStatus: "done", size: OGG_BYTES.length });
    expect(photo).toMatchObject({ text: "Así lo quiero", media: { downloadStatus: "done", mimeType: "image/jpeg", size: JPEG_BYTES.length } });
    expect(h.memory.files.size).toBe(2);
    expect(h.fetched.map((file) => file.host)).toEqual([WHATSAPP_MEDIA_HOST, WHATSAPP_MEDIA_HOST]);
    // What opens the file never reaches the database.
    expect(JSON.stringify(rows)).not.toMatch(/mediaKey|directPath/);
  });

  it("a file whose path could lead anywhere else is never asked for [SEG-05]", async () => {
    for (const safe of ["/v/t62.7117-24/1234_5678_n.enc?ccb=11-4&oh=01_AbC&oe=66AA&_nc_sid=5e03e0", "/o1/v/t24/f2/m232/archivo.enc"]) expect(isSafeDirectPath(safe)).toBe(true);
    for (const unsafe of ["//evil.example/x", "/@evil.example/x", "@evil.example/x", "https://evil.example/x", "/v/../../x", "/v/t62 con espacios", "", null, undefined, "/v/x#frag", "/v/x\\y"]) expect(isSafeDirectPath(unsafe)).toBe(false);
    const h = harness();
    const channelId = await linked(h);
    const voice = qrVoice({ id: "3EB0RARO" });
    (voice.message?.audioMessage as Record<string, unknown>).directPath = "/@evil.example/voz.enc";
    h.latest().receive([voice]);
    await idle(h, channelId);
    expect(h.fetched).toHaveLength(0);
    expect((await stored("inbound"))[0].media).toMatchObject({ downloadStatus: "failed" });
  });
});

describe("what the business writes from its phone [QR-09] [BAN-11]", () => {
  it("joins the customer's conversation as a person's and pauses the AI there; what the app sent is not taken for it", async () => {
    const h = harness();
    const channelId = await linked(h);
    h.latest().receive([qrText("¿A qué hora abrís?", { id: "3EB0PREGUNTA" })]);
    await idle(h, channelId);
    expect(await pendingJobs(REPLY_JOB)).toHaveLength(1);

    h.latest().receive([qrText("Abrimos a las 9, te espero.", { fromMe: true, id: "3EB0MOVIL" })]);
    await idle(h, channelId);
    const [echo] = await stored("outbound");
    expect(echo).toMatchObject({ senderType: "human", senderName: PHONE_SENDER_NAME, text: "Abrimos a las 9, te espero.", status: "sent", metadata: { sentFromPhone: true } });
    const [conversation] = await db.select().from(conversations);
    expect(echo.conversationId).toBe(conversation.id);
    expect(conversation.pauseReason).toBe(PHONE_PAUSE_REASON);
    expect(await pendingJobs(REPLY_JOB)).toHaveLength(0);
    expect(await db.select().from(contacts)).toHaveLength(1);

    // A message this process sent comes back as the phone's would: it is already in the conversation.
    const sent = await h.supervisor.send(channelId, QR_TEST.customer.lid, { kind: "text", text: "Hasta mañana." });
    expect(sent.ok).toBe(true);
    if (sent.ok) h.latest().receive([qrText("Hasta mañana.", { fromMe: true, id: sent.externalId })], "append");
    await idle(h, channelId);
    expect(await stored("outbound")).toHaveLength(1);
  });
});

describe("sending [QR-08]", () => {
  async function conversationOf(channelId: string) {
    const { contact } = await createContactWithIdentity("whatsapp", { externalId: QR_TEST.customer.lid, phone: QR_TEST.customer.digits });
    const conversation = await createConversation(channelId, contact.id);
    await createMessage(conversation, { externalId: "3EB0ENTRANTE", metadata: { whatsappJid: QR_TEST.customer.lid } });
    return conversation;
  }
  const outbound = (conversationId: string, overrides: Partial<OutboundMessage> = {}): OutboundMessage => ({
    messageId: crypto.randomUUID(),
    conversationId,
    recipient: { externalIds: [QR_TEST.customer.lid, QR_TEST.customer.digits], phone: QR_TEST.customer.digits, email: null, name: "Ana" },
    threadId: null,
    contentType: "text",
    text: "¡Hola, Ana!",
    ...overrides,
  });

  it("one text to the chat the customer wrote from, without a link preview, and its statuses move the message", async () => {
    const h = harness();
    const channelId = await linked(h);
    const conversation = await conversationOf(channelId);
    const adapter = createWhatsAppQrAdapter({ storage: h.memory.storage });
    const channel = await row(channelId);
    const sent = await adapter.send(channel, outbound(conversation.id));
    expect(h.latest().sent).toEqual([{ jid: QR_TEST.customer.lid, content: { text: "¡Hola, Ana!", linkPreview: null }, id: sent.externalId }]);
    expect(sent).toMatchObject({ status: "sent" });
    // Afterwards the account is «not here» again, so the phone keeps ringing.
    await vi.waitFor(() => expect(h.latest().presence.at(-1)).toEqual(["unavailable", undefined]));

    const ours = await createMessage(conversation, { direction: "outbound", senderType: "ai", externalId: sent.externalId, status: "sent", text: "¡Hola, Ana!" });
    h.latest().status(sent.externalId ?? "", 3);
    await idle(h, channelId);
    expect((await db.select().from(messages).where(eq(messages.id, ours.id)))[0].status).toBe("delivered");
    h.latest().status(sent.externalId ?? "", 4);
    h.latest().status(sent.externalId ?? "", 3);
    await idle(h, channelId);
    expect((await db.select().from(messages).where(eq(messages.id, ours.id)))[0].status).toBe("read");
  });

  it("a photo and a document go with their file; «escribiendo…» and the read mark go to the chat of the message", async () => {
    const h = harness();
    const channelId = await linked(h);
    const conversation = await conversationOf(channelId);
    const adapter = createWhatsAppQrAdapter({ storage: h.memory.storage });
    const channel = await row(channelId);
    await h.memory.storage.put("media/2026/09/foto.jpg", JPEG_BYTES, "image/jpeg");
    await h.memory.storage.put("media/2026/09/doc.pdf", new Uint8Array([37, 80, 68, 70]), "application/pdf");
    await adapter.send(channel, outbound(conversation.id, { contentType: "image", text: "Así queda", media: { fileKey: "media/2026/09/foto.jpg", mimeType: "image/jpeg" } }));
    await adapter.send(channel, outbound(conversation.id, { contentType: "document", text: null, media: { fileKey: "media/2026/09/doc.pdf", mimeType: "application/pdf", fileName: "presupuesto.pdf" } }));
    expect(h.latest().sent.map((item) => item.content)).toMatchObject([{ mimetype: "image/jpeg", caption: "Así queda" }, { mimetype: "application/pdf", fileName: "presupuesto.pdf" }]);
    expect(Buffer.isBuffer(h.latest().sent[0].content.image)).toBe(true);
    await expect(adapter.send(channel, outbound(conversation.id, { contentType: "template" }))).rejects.toBeInstanceOf(ChannelSendError);

    await adapter.sendTyping?.(channel, "3EB0ENTRANTE");
    await adapter.markRead?.(channel, "3EB0ENTRANTE");
    expect(h.latest().presence).toEqual(expect.arrayContaining([["available", undefined], ["composing", QR_TEST.customer.lid]]));
    expect(h.latest().read).toEqual([[{ remoteJid: QR_TEST.customer.lid, id: "3EB0ENTRANTE", fromMe: false }]]);
  });

  it("without an open session nothing is sent, and a failed send is never tried twice [MOT-10]", async () => {
    const h = harness();
    const channelId = await linked(h);
    const conversation = await conversationOf(channelId);
    const adapter = createWhatsAppQrAdapter({ storage: h.memory.storage });
    const channel = await row(channelId);
    h.latest().failSend = true;
    await expect(adapter.send(channel, outbound(conversation.id))).rejects.toMatchObject({ retryable: false, userMessage: expect.stringMatching(/No se ha podido enviar/) });

    // The connection drops: until it is back, sends are refused with what to do.
    h.latest().close(428);
    await idle(h, channelId);
    await expect(adapter.send(channel, outbound(conversation.id))).rejects.toMatchObject({ retryable: false, userMessage: QR_NOT_OPEN });
  });

  it("from the worker of an own server the web server is asked, with the secret both share; nobody else can [QR-02] [SEG-08]", async () => {
    const h = harness();
    const channelId = await linked(h);
    const conversation = await conversationOf(channelId);
    const channel = await row(channelId);
    await h.memory.storage.put("media/2026/09/foto.jpg", JPEG_BYTES, "image/jpeg");

    // Two processes in one test: the worker has no supervisor; the web server (the route) has this one.
    const asked: { url: string; authorization: string | null; body: unknown }[] = [];
    const webServer = (async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(String(input), init);
      asked.push({ url: request.url, authorization: request.headers.get("authorization"), body: JSON.parse(String(init?.body)) as unknown });
      setQrSupervisorForTests(h.supervisor);
      try {
        return await POST(request);
      } finally {
        setQrSupervisorForTests(null);
      }
    }) as typeof fetch;
    setQrSupervisorForTests(null);
    const worker = createWhatsAppQrAdapter({ askHost: (request) => askQrHost(request, { fetchImpl: webServer }) });

    const sent = await worker.send(channel, outbound(conversation.id));
    expect(h.latest().sent).toEqual([{ jid: QR_TEST.customer.lid, content: { text: "¡Hola, Ana!", linkPreview: null }, id: sent.externalId }]);
    expect(asked[0]).toMatchObject({ url: "http://localhost:3000/api/internal/whatsapp-qr", authorization: "Bearer test-only-cron-secret-0123456789", body: { action: "send", channelId, jid: QR_TEST.customer.lid, contentType: "text" } });
    await worker.sendTyping?.(channel, "3EB0ENTRANTE");
    expect(h.latest().presence).toEqual(expect.arrayContaining([["composing", QR_TEST.customer.lid]]));
    // A file travels by its key in the storage both processes read, never as bytes.
    setQrSupervisorForTests(h.supervisor);
    expect(await performQrRequest({ action: "send", channelId, jid: QR_TEST.customer.lid, contentType: "image", text: "Así queda", media: { fileKey: "media/2026/09/foto.jpg", mimeType: "image/jpeg" } }, { storage: h.memory.storage })).toMatchObject({ ok: true });
    expect(await performQrRequest({ action: "send", channelId, jid: QR_TEST.customer.lid, contentType: "document", text: null, media: { fileKey: "media/2026/09/no-existe.pdf" } }, { storage: h.memory.storage })).toMatchObject({ ok: false, error: expect.stringMatching(/archivo/) });

    // The route answers only to the shared secret, and only to what it understands.
    const call = (body: unknown, authorization: string | null = "Bearer test-only-cron-secret-0123456789") =>
      POST(new Request("http://localhost:3000/api/internal/whatsapp-qr", { method: "POST", headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) }, body: JSON.stringify(body) }));
    const valid = { action: "send", channelId, jid: QR_TEST.customer.lid, contentType: "text", text: "Hola", media: null };
    const before = h.latest().sent.length;
    expect((await call(valid, null)).status).toBe(401);
    expect((await call(valid, "Bearer otro-secreto")).status).toBe(401);
    for (const body of [null, {}, { ...valid, jid: "120363041234567890@g.us" }, { ...valid, channelId: "no-es-un-id" }, { ...valid, otra: "cosa" }, { ...valid, contentType: "image", media: { fileKey: "../../etc/passwd" } }]) {
      expect((await call(body)).status).toBe(400);
    }
    expect(h.latest().sent).toHaveLength(before);
    expect(await (await call(valid)).json()).toMatchObject({ ok: true, externalId: expect.any(String) });

    // Without a session anywhere, without the secret or without an answer, nothing is sent and it says so.
    setQrSupervisorForTests(null);
    expect(await (await call(valid)).json()).toEqual({ ok: false, error: QR_NOT_OPEN, retryable: false });
    await expect(createWhatsAppQrAdapter({ askHost: async () => ({ ok: false, error: QR_NOT_OPEN, retryable: false }) }).send(channel, outbound(conversation.id))).rejects.toMatchObject({ userMessage: QR_NOT_OPEN, retryable: false });
    expect(await askQrHost(valid as Parameters<typeof askQrHost>[0], { fetchImpl: (async () => new Response("<html>", { status: 502 })) as typeof fetch })).toMatchObject({ ok: false, retryable: false });
    expect(await askQrHost(valid as Parameters<typeof askQrHost>[0], { fetchImpl: (async () => Promise.reject(new Error("ECONNREFUSED"))) as typeof fetch })).toMatchObject({ ok: false });
    vi.stubEnv("CRON_SECRET", "");
    expect(await askQrHost(valid as Parameters<typeof askQrHost>[0], { fetchImpl: webServer })).toEqual({ ok: false, error: QR_NOT_OPEN, retryable: false });
    // On Vercel there is nobody to ask: no process there keeps a session.
    vi.stubEnv("VERCEL", "1");
    const askHost = vi.fn<typeof askQrHost>();
    expect(await requestOfQrHost(valid as Parameters<typeof askQrHost>[0], { askHost })).toEqual({ ok: false, error: QR_NOT_OPEN, retryable: false });
    expect(askHost).not.toHaveBeenCalled();
  });
});

describe("when the connection ends [QR-10]", () => {
  it("a network cut is recovered by itself, with growing waits", async () => {
    const h = harness();
    const channelId = await linked(h);
    h.latest().close(428);
    await idle(h, channelId);
    expect(h.supervisor.status(channelId)).toMatchObject({ state: "reconnecting" });
    expect(h.delays.map((delay) => delay.ms)).toEqual([RECONNECT_BASE_MS]);
    expect((await row(channelId)).status).toBe("connected");
    h.delays[0].run();
    await vi.waitFor(() => expect(h.sockets).toHaveLength(3));
    // Still no luck: the next wait is longer.
    h.latest().close(408);
    await idle(h, channelId);
    expect(h.delays.map((delay) => delay.ms)).toEqual([RECONNECT_BASE_MS, RECONNECT_BASE_MS * 2]);
    h.delays[1].run();
    await vi.waitFor(() => expect(h.sockets).toHaveLength(4));
    h.latest().open();
    await idle(h, channelId);
    expect(h.supervisor.status(channelId)).toMatchObject({ state: "open" });
    expect(await db.select().from(notifications)).toHaveLength(0);
  });

  it("the phone closing the session erases it, leaves the channel in «error» and tells owner and admins", async () => {
    const owner = await createUser("owner");
    const h = harness();
    const channelId = await linked(h);
    await createQrKeyStore(channelId).set({ session: { "34611222333.0": new Uint8Array([1]) } });
    h.latest().close(401);
    await idle(h, channelId);
    expect(h.supervisor.status(channelId)).toMatchObject({ state: "logged_out", error: expect.stringMatching(/Volver a vincular/) });
    expect(h.delays).toHaveLength(0);
    const after = await row(channelId);
    expect(after).toMatchObject({ status: "error", secretsEnc: null, lastHealth: { error: expect.stringMatching(/ya no está vinculado/) } });
    expect(await db.select().from(whatsappQrKeys)).toHaveLength(0);
    expect(await db.select().from(notifications).where(eq(notifications.userId, owner.userId))).toMatchObject([{ channelId, title: expect.stringMatching(/la sesión se ha cerrado/), link: `/canales/${channelId}` }]);
    // Its number stays: the same phone links it again from its panel.
    expect(after.phoneNumberId).toBe(`qr:${QR_TEST.self.digits}`);
  });

  it("another copy of the app taking the session is not fought: the session is kept and the panel says what to do", async () => {
    await createUser("owner");
    const h = harness();
    const channelId = await linked(h);
    h.latest().close(440);
    await idle(h, channelId);
    expect(h.supervisor.status(channelId)).toMatchObject({ state: "replaced" });
    expect(h.delays).toHaveLength(0);
    const after = await row(channelId);
    expect(after.status).toBe("error");
    expect(isLinked(loadQrCreds(after))).toBe(true);
    // «Reconectar» opens it again with the same session.
    await h.supervisor.start(channelId);
    expect(h.sockets).toHaveLength(3);
    h.latest().open();
    await idle(h, channelId);
    expect((await row(channelId)).status).toBe("connected");
  });

  it("«Desconectar» closes the session in WhatsApp and erases its keys; stopping only closes the connection [QR-12]", async () => {
    const h = harness();
    const channelId = await linked(h);
    const socket = h.latest();
    await h.supervisor.stop(channelId);
    expect(socket.ended).toBe(true);
    expect(socket.loggedOut).toBe(false);
    expect(isLinked(loadQrCreds(await row(channelId)))).toBe(true);
    expect(h.supervisor.status(channelId)).toBeNull();

    await h.supervisor.start(channelId);
    h.latest().open();
    await idle(h, channelId);
    expect(await h.supervisor.logout(channelId)).toEqual({ loggedOut: true });
    expect(h.latest().loggedOut).toBe(true);
    expect((await row(channelId)).secretsEnc).toBeNull();
    // Without an open connection WhatsApp cannot be told, and the session is erased all the same.
    expect(await h.supervisor.logout(channelId)).toEqual({ loggedOut: false });
  });

  it("never on Vercel: nothing there can keep a connection open [QR-02]", async () => {
    const h = harness();
    const channelId = await linked(h);
    await h.supervisor.stop(channelId);
    const channel = await row(channelId);
    // On Vercel nothing is even looked up: there is no embedded database there either.
    vi.stubEnv("VERCEL", "1");
    await h.supervisor.startAll();
    await h.supervisor.start(channelId, { pairing: true });
    expect(h.sockets).toHaveLength(2);
    expect((await whatsappQrAdapter.healthCheck(channel)).checks.find((check) => check.key === "process")).toMatchObject({ status: "error", detail: expect.stringMatching(/Vercel/) });
  });
});
