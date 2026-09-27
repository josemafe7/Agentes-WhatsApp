// Customers' files from WhatsApp ([WA-41], [SEG-13]): each kind with Meta's size limit (docs/integracion-whatsapp-
// mensajes.md §10.3), refused before being read whole, and never more of them in memory at once than the process
// allows. Meta is the fake Graph API; the files are made up.
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { channels, contactIdentities, contacts, conversations, jobs, messages, realtimeEvents, webhookEvents } from "@/db/schema";
import { createMetaGraphClient } from "@/lib/meta/client";
import { isMetaGraphError } from "@/lib/meta/errors";
import type { Job } from "@/server/adapters/job-queue";
import { MediaBusyError, MemoryGate } from "@/server/media/download-gate";
import { INBOUND_MEDIA_CAPS } from "@/server/media/limits";
import { createAgentRow, createBusiness, createChannel } from "@/test/factories";
import { fixtureText, signWebhook, WA_TEST, type WhatsAppFixture } from "@/test/fixtures/whatsapp";
import { FAKE_META_BASE_URL, fakeMetaFetch, type MetaHandler } from "@/test/fixtures/whatsapp/fake-meta";
import { memoryFileStorage } from "@/test/fixtures/whatsapp/memory-storage";
import { encryptWhatsAppSecrets } from "./config";
import { runMediaDownload } from "./jobs";
import { downloadAndStoreWhatsAppMedia, downloadWhatsAppMedia, MEDIA_DOWNLOAD_JOB, type MediaDownloadPayload } from "./media";
import { processWhatsAppWebhook } from "./webhook";

const T0 = new Date("2026-09-26T10:00:05Z");
const MEDIA_URL = "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=TEST900000000000009";

/** A file response that says it weighs `declared` bytes (the body itself is tiny: it is never read past the check). */
const declaring = (declared: number, contentType: string) => () =>
  new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": contentType, "content-length": String(declared) } });

function client(handler: MetaHandler) {
  const fake = fakeMetaFetch(handler);
  return { fake, client: createMetaGraphClient({ accessToken: WA_TEST.accessToken, baseUrl: FAKE_META_BASE_URL, fetchImpl: fake.fetch }) };
}

async function refusal(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

describe("each kind of file has Meta's size limit [WA-41] [SEG-13]", () => {
  const cases = [
    { contentType: "audio", mimeType: "audio/ogg; codecs=opus", cap: 16 * 1024 * 1024 },
    { contentType: "image", mimeType: "image/jpeg", cap: 5 * 1024 * 1024 },
    { contentType: "video", mimeType: "video/mp4", cap: 16 * 1024 * 1024 },
    { contentType: "sticker", mimeType: "image/webp", cap: 500 * 1024 },
    { contentType: "document", mimeType: "application/pdf", cap: 100 * 1024 * 1024 },
  ] as const;

  it("the limits are the ones of the docs", () => {
    for (const { contentType, cap } of cases) expect(INBOUND_MEDIA_CAPS[contentType]).toBe(cap);
  });

  it.each(cases)("$contentType: up to its limit it downloads; one byte more is refused before reading the file", async ({ contentType, mimeType, cap }) => {
    const ref = { mediaId: "900000000000009", url: MEDIA_URL, mimeType, contentType };
    expect((await downloadWhatsAppMedia(client(declaring(cap, mimeType)).client, ref)).bytes).toEqual(new Uint8Array([1, 2, 3]));
    const tooBig = await refusal(downloadWhatsAppMedia(client(declaring(cap + 1, mimeType)).client, ref));
    expect(isMetaGraphError(tooBig) && tooBig.httpStatus === 413 && !tooBig.retryable).toBe(true);
  });

  it("a file that does not say its size is cut off as soon as it passes the limit, without reading the rest", async () => {
    let sent = 0;
    const chunk = new Uint8Array(64 * 1024);
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const { client: meta } = client(() => new Response(endless, { headers: { "content-type": "image/jpeg" } }));
    const error = await refusal(downloadWhatsAppMedia(meta, { mediaId: "900000000000009", url: MEDIA_URL, mimeType: "image/jpeg", contentType: "image" }));
    expect(isMetaGraphError(error) && error.httpStatus === 413).toBe(true);
    expect(sent).toBeLessThan(INBOUND_MEDIA_CAPS.image + 4 * chunk.byteLength);
  });

  it("without the message's kind, the type decides (a PDF may be as big as a document)", async () => {
    const ref = { mediaId: "900000000000009", url: MEDIA_URL, mimeType: "application/pdf" };
    expect((await downloadWhatsAppMedia(client(declaring(20 * 1024 * 1024, "application/pdf")).client, ref)).bytes.byteLength).toBe(3);
    const audio = { ...ref, mimeType: "audio/mpeg" };
    expect(isMetaGraphError(await refusal(downloadWhatsAppMedia(client(declaring(20 * 1024 * 1024, "audio/mpeg")).client, audio)))).toBe(true);
  });
});

describe("never more files in memory at once than the process allows [WA-41]", () => {
  it("a download waits for its turn and stores its file once it gets it", async () => {
    const gate = new MemoryGate(INBOUND_MEDIA_CAPS.document, 1);
    const { storage, files } = memoryFileStorage();
    const releaseFirst = await gate.acquire(INBOUND_MEDIA_CAPS.audio, 1_000);
    const { fake, client: meta } = client(() => new Response(new Uint8Array([79, 103, 103, 83]), { headers: { "content-type": "audio/ogg" } }));
    const stored = downloadAndStoreWhatsAppMedia(meta, { mediaId: "900000000000009", url: MEDIA_URL, mimeType: "audio/ogg", contentType: "audio" }, { storage, gate, waitMs: 1_000 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    // Nothing was asked to Meta while the other download holds the place.
    expect(fake.calls).toHaveLength(0);
    releaseFirst();
    const media = await stored;
    expect(media).toMatchObject({ downloadStatus: "done", size: 4 });
    expect(files.has(media.fileKey)).toBe(true);
    // Its place is given back once stored.
    expect(gate.usage()).toEqual({ active: 0, reservedBytes: 0, waiting: 0 });
  });

  it("the place is given back even when the download fails", async () => {
    const gate = new MemoryGate(INBOUND_MEDIA_CAPS.document, 1);
    const { client: meta } = client(declaring(INBOUND_MEDIA_CAPS.audio + 1, "audio/ogg"));
    const error = await refusal(downloadAndStoreWhatsAppMedia(meta, { mediaId: "900000000000009", url: MEDIA_URL, mimeType: "audio/ogg", contentType: "audio" }, { storage: memoryFileStorage().storage, gate }));
    expect(isMetaGraphError(error)).toBe(true);
    expect(gate.usage()).toEqual({ active: 0, reservedBytes: 0, waiting: 0 });
  });

  it("one that cannot get its turn in time fails as retryable, and Meta is never asked", async () => {
    const gate = new MemoryGate(INBOUND_MEDIA_CAPS.document, 1);
    const busy = await gate.acquire(INBOUND_MEDIA_CAPS.document, 1_000);
    const { fake, client: meta } = client(declaring(3, "audio/ogg"));
    const error = await refusal(downloadAndStoreWhatsAppMedia(meta, { mediaId: "900000000000009", url: MEDIA_URL, mimeType: "audio/ogg", contentType: "audio" }, { storage: memoryFileStorage().storage, gate, waitMs: 20 }));
    expect(error).toBeInstanceOf(MediaBusyError);
    expect(fake.calls).toHaveLength(0);
    busy();
  });
});

describe("the download job applies the limit of the message's kind [WA-41]", () => {
  beforeEach(async () => {
    for (const table of [messages, conversations, contactIdentities, contacts, webhookEvents, jobs, realtimeEvents]) await db.delete(table);
    await db.delete(channels);
    await createBusiness();
    const agent = await createAgentRow();
    await createChannel({
      type: "whatsapp",
      name: "WhatsApp Peluquería",
      status: "connected",
      phoneNumberId: WA_TEST.phoneNumberId,
      wabaId: WA_TEST.wabaId,
      metaAppId: WA_TEST.appId,
      graphApiVersion: "v26.0",
      activeAgentId: agent.id,
      secretsEnc: encryptWhatsAppSecrets({ accessToken: WA_TEST.accessToken, appSecret: WA_TEST.appSecret, twoStepPin: null }),
    });
  });

  async function receiveAndDownload(name: WhatsAppFixture, declared: number, contentType: string, edit: (text: string) => string = (text) => text) {
    const text = edit(fixtureText(name));
    await processWhatsAppWebhook(new TextEncoder().encode(text), signWebhook(text), { now: T0 });
    const [row] = await db.select().from(jobs).where(eq(jobs.type, MEDIA_DOWNLOAD_JOB));
    const job: Job = { ...row, attempts: 1 };
    const fake = fakeMetaFetch(declaring(declared, contentType));
    const outcome = await runMediaDownload(row.payload as MediaDownloadPayload, { job, remainingMs: () => 60_000 }, { fetchImpl: fake.fetch, baseUrl: FAKE_META_BASE_URL, storage: memoryFileStorage().storage });
    const [message] = await db.select().from(messages).where(and(eq(messages.direction, "inbound"), eq(messages.contentType, name === "voice" ? "audio" : "document")));
    return { outcome, message };
  }

  it("a 20 MB voice note is over the audio limit: «No se pudo descargar el archivo» at once, no retries", async () => {
    const { outcome, message } = await receiveAndDownload("voice", 20 * 1024 * 1024, "audio/ogg");
    expect(outcome).toBe("failed");
    expect(message.media?.downloadStatus).toBe("failed");
  });

  it("an MP3 sent as a document keeps the document's limit: 20 MB are downloaded and stored", async () => {
    const asMp3 = (text: string) => text.replace('"application/pdf"', '"audio/mpeg"').replace("presupuesto-prueba.pdf", "nota-larga.mp3");
    const { outcome, message } = await receiveAndDownload("document", 20 * 1024 * 1024, "audio/mpeg", asMp3);
    expect(outcome).toBe("done");
    expect(message.media).toMatchObject({ downloadStatus: "done", fileName: "nota-larga.mp3" });
  });
});
