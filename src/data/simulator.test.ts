// Simulador de canales ([AJU-11]–[AJU-13]): a message written as a customer goes through the real ingest pipeline,
// is marked as simulated, and the AI's reply never leaves the app. Owner and admin only.
import { and, asc, eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import {
  agents,
  aiRuns,
  appKv,
  auditLog,
  channels,
  contactIdentities,
  contacts,
  conversations,
  handoffEvents,
  jobs,
  messages,
  notifications,
  rateLimits,
  realtimeEvents,
} from "@/db/schema";
import type { Role } from "@/lib/enums";
import type { FileStorage } from "@/server/adapters/file-storage";
import { registerChannelAdapter, unregisterChannelAdapter } from "@/server/channels/registry";
import type { ChannelAdapter } from "@/server/channels/types";
import { processReplyJob } from "@/server/engine/reply";
import { REPLY_JOB, replyJobPayload, type ReplyJobPayload } from "@/server/engine/schedule";
import { chatCompletion, FAKE_OPENROUTER_KEY, fakeFetch, jsonResponse, routes, sampleCatalog } from "@/test/fake-openrouter";
import { createAgentRow, createBusiness, createChannel, createContactWithIdentity, createUser, type TestUser } from "@/test/factories";
import { detectSimulatorFile, loadSimulatorOptions, MAX_SIMULATOR_UPLOAD_BYTES, simulateInboundMessage } from "./simulator";

const NOW = new Date("2026-09-30T09:00:00Z");

/** Files stay in memory: tests never write into the project's data/uploads. */
function memoryStorage() {
  const files = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const storage: FileStorage = {
    kind: "disk",
    put: async (key, data, contentType) => {
      files.set(key, { bytes: data, contentType });
      return { key, size: data.byteLength };
    },
    get: async () => null,
    delete: async (key) => {
      files.delete(key);
    },
    exists: async (key) => files.has(key),
  };
  return { storage, files };
}

let owner: TestUser;
let admin: TestUser;
let agent: typeof agents.$inferSelect;
let memory: ReturnType<typeof memoryStorage>;

async function clear() {
  for (const table of [notifications, handoffEvents, aiRuns, messages, conversations, contactIdentities, contacts, jobs, realtimeEvents, appKv, auditLog, rateLimits]) {
    await db.delete(table);
  }
  await db.delete(channels);
}

const send = (actor: TestUser, input: Record<string, unknown>) => simulateInboundMessage(actor.actor, input, { storage: memory.storage, now: NOW });

beforeAll(async () => {
  await createBusiness({ name: "Peluquería Lola", sector: "peluqueria", timezone: "Europe/Madrid" });
  owner = await createUser("owner");
  admin = await createUser("admin");
  agent = await createAgentRow({ name: "Recepción" });
});

beforeEach(async () => {
  await clear();
  memory = memoryStorage();
});

afterEach(() => {
  vi.unstubAllEnvs();
  unregisterChannelAdapter("whatsapp");
});

describe("simulador: the same path as a real message [AJU-12]", () => {
  it("a new WhatsApp customer: contact and identity (never the phone as key), conversation, message, screens and the grouped reply", async () => {
    const whatsapp = await createChannel({ type: "whatsapp", name: "WhatsApp", isDemo: true, activeAgentId: agent.id });
    const result = await send(owner, {
      channelId: whatsapp.id,
      contact: { mode: "new", name: "Ana Pruebas", phone: "+34 600 111 222" },
      contentType: "text",
      text: "Hola, ¿tenéis hueco mañana?",
    });

    const [contact] = await db.select().from(contacts).where(eq(contacts.id, result.contactId));
    expect(contact).toMatchObject({ name: "Ana Pruebas", phone: "34600111222" });
    const identities = await db.select().from(contactIdentities).where(eq(contactIdentities.contactId, contact.id));
    expect(identities).toHaveLength(1);
    expect(identities[0].channelType).toBe("whatsapp");
    expect(identities[0].externalId).toMatch(/^ES\.\d{20}$/);

    const [conversation] = await db.select().from(conversations).where(eq(conversations.id, result.conversationId));
    expect(conversation).toMatchObject({ channelId: whatsapp.id, contactId: contact.id, status: "open", aiMode: "ai", unreadCount: 1, metadata: { simulated: true } });
    const [message] = await db.select().from(messages).where(eq(messages.id, result.messageId));
    expect(message).toMatchObject({ direction: "inbound", senderType: "contact", contentType: "text", text: "Hola, ¿tenéis hueco mañana?", status: "received", simulated: true });

    // Screens are told and the reply is scheduled a few seconds later, grouped ([CAN-09], [MOT-01]).
    const events = await db.select().from(realtimeEvents);
    expect(events.map((event) => (event.payload as { type: string }).type)).toContain("message.created");
    const [job] = await db.select().from(jobs).where(eq(jobs.type, REPLY_JOB));
    expect(job).toMatchObject({ status: "pending", dedupeKey: `reply:${conversation.id}` });
    expect(result.replyRunAt?.getTime()).toBe(job.runAt.getTime());
    expect(result).toMatchObject({ channelName: "WhatsApp", contactName: "Ana Pruebas", duplicate: false });

    // No key in tests: the message waits for a person, and the screen says why.
    expect(result.aiReply).toEqual({ expected: false, reason: "falta la clave de OpenRouter (Ajustes › IA)" });
    const [entry] = await db.select().from(auditLog);
    expect(entry).toMatchObject({ action: "simulator.message_sent", actorUserId: owner.userId, targetId: conversation.id });
  });

  it("an existing contact writes again in the same conversation (one per channel and contact, [CAN-12])", async () => {
    const whatsapp = await createChannel({ type: "whatsapp", name: "WhatsApp", isDemo: true, activeAgentId: agent.id });
    const { contact } = await createContactWithIdentity("whatsapp", { name: "Luis", externalId: "ES.10000000000000000001", phone: "34600000001" });
    const first = await send(admin, { channelId: whatsapp.id, contact: { mode: "existing", contactId: contact.id }, contentType: "text", text: "Hola" });
    const second = await send(admin, { channelId: whatsapp.id, contact: { mode: "existing", contactId: contact.id }, contentType: "text", text: "¿Seguís ahí?" });
    expect(first.contactId).toBe(contact.id);
    expect(second.conversationId).toBe(first.conversationId);
    expect(await db.select().from(contacts)).toHaveLength(1);
    const [conversation] = await db.select().from(conversations);
    expect(conversation.unreadCount).toBe(2);
  });

  it("with a key, the AI is expected to answer; with the channel's AI off or without agent, the screen says it will not", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
    const on = await createChannel({ type: "webchat", name: "Web", activeAgentId: agent.id });
    const off = await createChannel({ type: "webchat", name: "Web sin IA", activeAgentId: agent.id, aiEnabled: false });
    const none = await createChannel({ type: "webchat", name: "Web sin agente" });
    const text = { contact: { mode: "new" }, contentType: "text", text: "Hola" };
    expect((await send(owner, { ...text, channelId: on.id })).aiReply).toEqual({ expected: true, reason: null });
    expect((await send(owner, { ...text, channelId: off.id })).aiReply).toEqual({ expected: false, reason: "la IA de este canal está apagada" });
    expect((await send(owner, { ...text, channelId: none.id })).aiReply).toEqual({ expected: false, reason: "el canal no tiene agente activo" });
  });

  it("[SEG-07] like «Probar agente», each person sends at most 20 messages a minute (each one may make the AI answer)", async () => {
    const web = await createChannel({ type: "webchat", name: "Web", activeAgentId: agent.id });
    const hello = { channelId: web.id, contact: { mode: "new" }, contentType: "text", text: "Hola" };
    for (let index = 0; index < 20; index++) await send(owner, hello);
    await expect(send(owner, hello)).rejects.toMatchObject({ status: 429 });
    expect(await db.select().from(messages)).toHaveLength(20);
    // Another person has their own count.
    expect((await send(admin, hello)).messageId).toBeTruthy();
  });

  it("a contact without an identity in the channel type cannot write there, and nothing is stored", async () => {
    const whatsapp = await createChannel({ type: "whatsapp", name: "WhatsApp", isDemo: true });
    const { contact } = await createContactWithIdentity("webchat", { name: "Visitante" });
    await expect(send(owner, { channelId: whatsapp.id, contact: { mode: "existing", contactId: contact.id }, contentType: "text", text: "Hola" })).rejects.toMatchObject({
      status: 400,
      fieldErrors: { contact: [expect.stringContaining("no tiene identidad")] },
    });
    expect(await db.select().from(messages)).toEqual([]);
  });

  it("[CAN-12] email: a new contact needs an address; the next message continues its thread, with its subject", async () => {
    const email = await createChannel({ type: "email_gmail", name: "Correo", isDemo: true, replyMode: "draft", activeAgentId: agent.id });
    await expect(send(owner, { channelId: email.id, contact: { mode: "new", name: "Sin correo" }, contentType: "text", text: "Hola" })).rejects.toMatchObject({ status: 400 });
    const first = await send(owner, {
      channelId: email.id,
      contact: { mode: "new", name: "Marta", email: "Marta@Correo.Example" },
      contentType: "text",
      subject: "Consulta de horario",
      text: "Buenos días, ¿abrís el sábado?",
    });
    const second = await send(owner, { channelId: email.id, contact: { mode: "existing", contactId: first.contactId }, contentType: "text", text: "Perdón, otra pregunta." });
    expect(second.conversationId).toBe(first.conversationId);
    const [conversation] = await db.select().from(conversations);
    expect(conversation.externalThreadId).toMatch(/^sim-thread-/);
    const [identity] = await db.select().from(contactIdentities);
    expect(identity).toMatchObject({ channelType: "email_gmail", externalId: "marta@correo.example" });
    const [firstMessage] = await db.select().from(messages).where(eq(messages.id, first.messageId));
    expect(firstMessage.metadata).toEqual({ subject: "Consulta de horario" });
  });
});

describe("simulador: voice notes, images and documents [AJU-12] [SEG-13]", () => {
  it("the ready-made samples are stored and attached as each type", async () => {
    const whatsapp = await createChannel({ type: "whatsapp", name: "WhatsApp", isDemo: true, activeAgentId: agent.id });
    const cases = [
      ["audio", "audio/wav", ".wav"],
      ["image", "image/png", ".png"],
      ["document", "application/pdf", ".pdf"],
    ] as const;
    for (const [contentType, mimeType, extension] of cases) {
      const result = await send(owner, { channelId: whatsapp.id, contact: { mode: "new" }, contentType, text: contentType === "image" ? "¿Me hacéis este color?" : undefined });
      const [message] = await db.select().from(messages).where(eq(messages.id, result.messageId));
      expect(message.contentType).toBe(contentType);
      expect(message.media).toMatchObject({ mimeType, downloadStatus: "done" });
      expect(message.media?.fileKey).toMatch(new RegExp(`^media/\\d{4}/\\d{2}/[0-9a-f-]{36}\\${extension}$`));
      const stored = memory.files.get(message.media?.fileKey ?? "");
      expect(stored?.contentType).toBe(mimeType);
      expect(message.media?.size).toBe(stored?.bytes.byteLength);
    }
    const [image] = await db.select().from(messages).where(eq(messages.contentType, "image"));
    expect(image.text).toBe("¿Me hacéis este color?");
  });

  it("a file of one's own is checked by its content and size; a wrong one is refused and nothing is kept", async () => {
    const whatsapp = await createChannel({ type: "whatsapp", name: "WhatsApp", isDemo: true, activeAgentId: agent.id });
    const mp3 = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xfb, 0x90, 0x64]);
    const ok = await send(owner, { channelId: whatsapp.id, contact: { mode: "new" }, contentType: "audio", file: { source: "upload", bytes: mp3, fileName: "nota.mp3" } });
    const [message] = await db.select().from(messages).where(eq(messages.id, ok.messageId));
    expect(message.media).toMatchObject({ mimeType: "audio/mpeg", fileName: "nota.mp3", size: mp3.byteLength });
    expect(message.media?.fileKey).toMatch(/\.mp3$/);

    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    await expect(send(owner, { channelId: whatsapp.id, contact: { mode: "new" }, contentType: "image", file: { source: "upload", bytes: html, fileName: "foto.png" } })).rejects.toMatchObject({
      fieldErrors: { file: ["La imagen tiene que ser PNG, JPG o WebP."] },
    });
    const big = new Uint8Array(MAX_SIMULATOR_UPLOAD_BYTES + 1);
    big.set(new TextEncoder().encode("%PDF-1.4"));
    await expect(send(owner, { channelId: whatsapp.id, contact: { mode: "new" }, contentType: "document", file: { source: "upload", bytes: big } })).rejects.toMatchObject({
      fieldErrors: { file: ["El archivo puede ocupar como mucho 1 MB."] },
    });
    expect(memory.files.size).toBe(1);
    expect(await db.select().from(messages)).toHaveLength(1);
  });

  it("[WEB-07] [CAN-14] only what the channel admits: a web chat without voice notes refuses audio, and none takes documents", async () => {
    const quiet = await createChannel({ type: "webchat", name: "Web", activeAgentId: agent.id, config: { voiceEnabled: false, imagesEnabled: true } });
    await expect(send(owner, { channelId: quiet.id, contact: { mode: "new" }, contentType: "audio" })).rejects.toMatchObject({
      fieldErrors: { contentType: ["Este canal no admite notas de voz."] },
    });
    await expect(send(owner, { channelId: quiet.id, contact: { mode: "new" }, contentType: "document" })).rejects.toMatchObject({
      fieldErrors: { contentType: ["Este canal no admite documentos."] },
    });
    const image = await send(owner, { channelId: quiet.id, contact: { mode: "new" }, contentType: "image" });
    expect(image.messageId).toBeTruthy();
    expect(memory.files.size).toBe(1);
  });

  it("detects voice notes and images as the web chat does, and PDFs, by their bytes, never by name", () => {
    const bytes = (...values: (number | string)[]) =>
      new Uint8Array([...values.flatMap((value) => (typeof value === "string" ? [...value].map((char) => char.charCodeAt(0)) : [value])), ...new Array(16).fill(0)]);
    expect(detectSimulatorFile("audio", bytes("OggS"))?.mimeType).toBe("audio/ogg");
    expect(detectSimulatorFile("audio", bytes("RIFF", 0, 0, 0, 0, "WAVE"))?.mimeType).toBe("audio/wav");
    expect(detectSimulatorFile("audio", bytes(0, 0, 0, 0x20, "ftypM4A "))?.mimeType).toBe("audio/mp4");
    expect(detectSimulatorFile("audio", bytes(0x1a, 0x45, 0xdf, 0xa3))?.mimeType).toBe("audio/webm");
    expect(detectSimulatorFile("audio", bytes(0xff, 0xfb, 0x90))?.mimeType).toBe("audio/mpeg");
    expect(detectSimulatorFile("audio", bytes("ID3"))?.mimeType).toBe("audio/mpeg");
    expect(detectSimulatorFile("audio", bytes("%PDF-"))).toBeNull();
    // An image is not a voice note, nor the other way round.
    expect(detectSimulatorFile("audio", bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a))).toBeNull();
    expect(detectSimulatorFile("image", bytes("OggS"))).toBeNull();
    expect(detectSimulatorFile("document", bytes("%PDF-1.7"))?.mimeType).toBe("application/pdf");
    expect(detectSimulatorFile("image", bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a))?.mimeType).toBe("image/png");
    expect(detectSimulatorFile("image", bytes("GIF89a"))).toBeNull();
    expect(detectSimulatorFile("audio", new Uint8Array([0x4f, 0x67]))).toBeNull();
  });
});

describe("simulador: replies never leave the app [AJU-13]", () => {
  it("even on a real WhatsApp channel, the AI's reply goes through the DemoAdapter and is marked as simulated", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
    const realSend = vi.fn();
    const realWhatsapp: ChannelAdapter = {
      type: "whatsapp",
      capabilities: () => ({ audio: true, images: true, documents: true, templates: true, window24h: true, typing: true, readReceipts: true, html: false, drafts: false }),
      validateAndConnect: async () => ({ ok: true }),
      healthCheck: async () => ({ checkedAt: NOW.toISOString(), checks: [] }),
      handleWebhook: async () => [],
      send: realSend,
      downloadMedia: async () => {
        throw new Error("no");
      },
      markRead: realSend,
      sendTyping: realSend,
      disconnect: async () => undefined,
    };
    registerChannelAdapter(realWhatsapp);
    const whatsapp = await createChannel({ type: "whatsapp", name: "WhatsApp real", isDemo: false, status: "connected", activeAgentId: agent.id });

    const result = await send(owner, { channelId: whatsapp.id, contact: { mode: "new", name: "Prueba" }, contentType: "text", text: "¿Qué horario tenéis?" });
    expect(result.aiReply.expected).toBe(true);
    const [job] = await db.select().from(jobs).where(and(eq(jobs.type, REPLY_JOB), eq(jobs.status, "pending")));
    const fake = fakeFetch(routes({ "GET /models/user": () => jsonResponse({ data: sampleCatalog() }), "POST /chat/completions": () => jsonResponse(chatCompletion({ content: "Abrimos de martes a sábado." })) }));
    const outcome = await processReplyJob(replyJobPayload.parse(job.payload) as ReplyJobPayload, { job, rescheduleAt: () => undefined, remainingMs: () => 120_000 }, {
      fetchImpl: fake.fetch,
      now: new Date(NOW.getTime() + 10_000),
      retryDelayMs: 0,
    });
    expect(outcome.kind).toBe("replied");

    const outbound = await db
      .select()
      .from(messages)
      .where(and(eq(messages.conversationId, result.conversationId), eq(messages.direction, "outbound")))
      .orderBy(asc(messages.createdAt));
    expect(outbound).toHaveLength(1);
    expect(outbound[0]).toMatchObject({ senderType: "ai", status: "sent", simulated: true, agentId: agent.id });
    expect(outbound[0].text).toContain("Abrimos de martes a sábado.");
    expect(outbound[0].externalId).toMatch(/^demo-/);
    // Nothing reached the real channel: no send, no «leído», no «escribiendo…».
    expect(realSend).not.toHaveBeenCalled();
  });
});

describe("simulador: the options on screen", () => {
  it("lists every channel with its agent and what it admits, and the contacts with an identity in each type", async () => {
    const whatsapp = await createChannel({ type: "whatsapp", name: "WhatsApp", isDemo: true, activeAgentId: agent.id });
    await createChannel({ type: "webchat", name: "Chat", config: { voiceEnabled: true, imagesEnabled: false } });
    const { contact } = await createContactWithIdentity("whatsapp", { name: "Luis", externalId: "ES.10000000000000000002", phone: "34600000002" });
    await createContactWithIdentity("webchat", { name: null });
    const options = await loadSimulatorOptions(admin.actor);
    expect(options.channels.map((channel) => [channel.name, channel.type, channel.isDemo, channel.activeAgentName, channel.capabilities])).toEqual([
      ["Chat", "webchat", false, null, { audio: true, images: false, documents: false }],
      ["WhatsApp", "whatsapp", true, "Recepción", { audio: true, images: true, documents: true }],
    ]);
    expect(options.contactsByType.whatsapp).toEqual([{ id: contact.id, name: "Luis", externalId: "ES.10000000000000000002", phone: "34600000002", email: null }]);
    expect(options.contactsByType.webchat).toHaveLength(1);
    expect(whatsapp.id).toBeTruthy();
  });
});

describe.each<Role>(["supervisor", "agent", "viewer"])("simulador as %s [PER-03] [PER-04] [SEG-04]", (role) => {
  it("cannot open it nor send anything; nothing is stored", async () => {
    const whatsapp = await createChannel({ type: "whatsapp", name: "WhatsApp", isDemo: true, activeAgentId: agent.id });
    const person = await createUser(role);
    await expect(loadSimulatorOptions(person.actor)).rejects.toMatchObject({ status: 403 });
    await expect(send(person, { channelId: whatsapp.id, contact: { mode: "new" }, contentType: "audio" })).rejects.toMatchObject({ status: 403 });
    expect(await db.select().from(messages)).toEqual([]);
    expect(await db.select().from(contacts)).toEqual([]);
    expect(memory.files.size).toBe(0);
  });
});
