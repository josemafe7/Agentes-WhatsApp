import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureSettingsRows } from "@/data/settings";
import { db } from "@/db";
import { agents, aiRuns, appKv, channels, contactIdentities, contacts, conversations, integrationSettings, messages, type MessageMedia } from "@/db/schema";
import type { MessageContentType, SenderType } from "@/lib/enums";
import { DEFAULT_MODELS } from "@/lib/openrouter/default-models";
import type { ContentPart, ModelSupport } from "@/lib/openrouter/types";
import { DiskStorage } from "@/server/adapters/file-storage";
import { buildPrompt, type BuildPromptInput } from "@/server/ai/prompt";
import {
  chatCompletion,
  FAKE_OPENROUTER_KEY,
  fakeFetch,
  jsonResponse,
  modelEndpointsBody,
  routes,
  sampleCatalog,
  sequence,
  VOXTRAL_ENDPOINTS,
  WHISPER_ENDPOINTS,
  zdrEndpointsBody,
  type FakeHandler,
} from "@/test/fake-openrouter";
import { createAgentRow, createBusiness, createChannel, createContactWithIdentity, createConversation, createMessage } from "@/test/factories";
import type { FfmpegRunner } from "./ffmpeg";
import { MEDIA_LIMITS } from "./limits";
import { prepareMessagesForModel, type ModelInputMessage, type PrepareContext } from "./prepare";
import { storeInboundMedia } from "./store";
import { makePdf, PNG_1X1 } from "./test-fixtures";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dominia-media-prepare-"));
const storage = new DiskStorage(dir);
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const OGG = new TextEncoder().encode("OggS-voice-note");
const TEXT_ONLY: ModelSupport = { supportedEfforts: null, reasoningMandatory: false, supportsTemperature: false, maxCompletionTokens: null, inputModalities: ["text"] };
const SEES_ALL: ModelSupport = { ...TEXT_ONLY, inputModalities: ["text", "image", "file"] };

type Fake = ReturnType<typeof fakeFetch>;
function openRouter(table: { transcription?: FakeHandler[]; chat?: FakeHandler[] } = {}): Fake {
  return fakeFetch(
    routes({
      "GET /models/user": () => jsonResponse({ data: sampleCatalog() }),
      "POST /audio/transcriptions": sequence(...(table.transcription ?? [() => jsonResponse({ text: "Quería una cita para el martes", usage: { seconds: 3, cost: 0.00001 } })])),
      "POST /chat/completions": sequence(...(table.chat ?? [() => jsonResponse(chatCompletion({ content: "Foto de un recogido con trenzas.", model: DEFAULT_MODELS.imageDescription }))])),
    }),
  );
}
const callsTo = (fake: Fake, route: string) => fake.calls.filter((call) => call.path === route);

let conversation: typeof conversations.$inferSelect;
let agentId: string;
let channelId: string;
const conversions: string[] = [];
const ffmpeg: FfmpegRunner = async ({ extension }) => {
  conversions.push(extension);
  return new TextEncoder().encode("ID3-converted");
};

async function clear() {
  for (const table of [aiRuns, messages, conversations, contactIdentities, contacts, appKv]) await db.delete(table);
  await db.update(channels).set({ activeAgentId: null });
  await db.delete(channels);
  await db.delete(agents);
}

beforeEach(async () => {
  await clear();
  await createBusiness();
  await ensureSettingsRows();
  await db.update(integrationSettings).set({ zdr: false, defaultModels: {} });
  vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
  conversions.length = 0;
  const agent = await createAgentRow();
  agentId = agent.id;
  const channel = await createChannel({ type: "webchat", activeAgentId: agent.id });
  channelId = channel.id;
  const { contact } = await createContactWithIdentity("webchat");
  conversation = await createConversation(channel.id, contact.id);
});

afterEach(() => vi.unstubAllEnvs());

async function mediaMessage(contentType: MessageContentType, bytes: Uint8Array, mimeType: string, extra: { fileName?: string; senderType?: SenderType; conversationId?: string } = {}) {
  const media = await storeInboundMedia({ bytes, mimeType, fileName: extra.fileName }, { storage });
  const target = extra.conversationId ? { id: extra.conversationId, channelId } : conversation;
  return createMessage(target, {
    contentType,
    text: null,
    media,
    senderType: extra.senderType ?? "contact",
    direction: extra.senderType && extra.senderType !== "contact" ? "outbound" : "inbound",
    status: extra.senderType && extra.senderType !== "contact" ? "sent" : "received",
  });
}

async function load(ids: string[]): Promise<ModelInputMessage[]> {
  const rows = await Promise.all(ids.map(async (id) => (await db.select().from(messages).where(eq(messages.id, id)))[0]));
  return rows.map((row) => ({
    id: row.id,
    senderType: row.senderType,
    contentType: row.contentType,
    text: row.text,
    transcript: row.transcript,
    media: row.media,
    metadata: row.metadata,
    createdAt: row.createdAt,
  }));
}

function context(fake: Fake, overrides: Partial<PrepareContext> = {}): PrepareContext {
  return { conversationId: conversation.id, channelId, agentId, model: "openai/gpt-5.6-luna", fetchImpl: fake.fetch, storage, ffmpeg, ...overrides };
}

const row = async (id: string) => (await db.select().from(messages).where(eq(messages.id, id)))[0];

function promptFor(history: Awaited<ReturnType<typeof prepareMessagesForModel>>) {
  const input: BuildPromptInput = {
    business: { name: "Peluquería Prueba", sector: null, contactEmail: null, contactPhone: null, address: null, website: null },
    hours: [],
    closures: [],
    services: [],
    agent: { name: "Recepción", language: "es", tone: null, instructions: {} },
    contextFiles: [],
    channel: { kind: "webchat" },
    contact: null,
    summary: null,
    history,
    now: new Date("2026-09-30T10:00:00Z"),
    timezone: "Europe/Madrid",
  };
  return buildPrompt(input).messages.slice(1);
}

describe("text-only turns", () => {
  it("text messages pass through without calling OpenRouter", async () => {
    const message = await createMessage(conversation, { text: "Hola, ¿abrís el sábado?" });
    const fake = openRouter();
    const history = await prepareMessagesForModel(await load([message.id]), context(fake));
    expect(history).toEqual([{ role: "contact", text: "Hola, ¿abrís el sábado?", contentType: "text", transcript: null, fileName: null }]);
    expect(fake.calls).toHaveLength(0);
  });
});

describe("audios [MED-01] [MED-03] [MED-04]", () => {
  it("transcribes a new voice note, saves the transcript on the message, and the agent gets the text", async () => {
    const message = await mediaMessage("audio", OGG, "audio/ogg; codecs=opus");
    const fake = openRouter();
    const history = await prepareMessagesForModel(await load([message.id]), context(fake));
    expect(history[0]).toMatchObject({ role: "contact", contentType: "audio", transcript: "Quería una cita para el martes" });
    expect((await row(message.id)).transcript).toBe("Quería una cita para el martes");
    expect(promptFor(history)).toEqual([{ role: "user", content: "[Nota de voz] Quería una cita para el martes" }]);
    const [run] = await db.select().from(aiRuns);
    expect(run).toMatchObject({ kind: "transcription", messageId: message.id, conversationId: conversation.id, agentId, costUsd: 0.00001 });

    // The stored transcript is used from then on: no second transcription (the engine may retry the turn).
    await prepareMessagesForModel(await load([message.id]), context(fake));
    expect(callsTo(fake, "/audio/transcriptions")).toHaveLength(1);
  });

  it("[CUM-05] saves when the voice note was transcribed: its file is kept 30 days from then", async () => {
    const message = await mediaMessage("audio", OGG, "audio/ogg; codecs=opus");
    await db.update(messages).set({ metadata: { kept: "sí" } }).where(eq(messages.id, message.id));
    const before = Date.now();
    await prepareMessagesForModel(await load([message.id]), context(openRouter()));
    const { metadata, transcript } = await row(message.id);
    expect(transcript).toBe("Quería una cita para el martes");
    expect(metadata).toMatchObject({ kept: "sí", transcribedAt: expect.any(String) });
    const transcribedAt = Date.parse(String(metadata.transcribedAt));
    expect(transcribedAt).toBeGreaterThanOrEqual(before);
    expect(transcribedAt).toBeLessThanOrEqual(Date.now());
  });

  it("uses the transcription model of Settings › IA", async () => {
    await db.update(integrationSettings).set({ defaultModels: { transcription: "mistralai/voxtral-mini-transcribe" } });
    const message = await mediaMessage("audio", OGG, "audio/ogg");
    const fake = openRouter();
    await prepareMessagesForModel(await load([message.id]), context(fake));
    expect((callsTo(fake, "/audio/transcriptions")[0].body as { model: string }).model).toBe("mistralai/voxtral-mini-transcribe");
  });

  it("when it cannot be transcribed, the message says so and the agent asks the customer to write it", async () => {
    const message = await mediaMessage("audio", OGG, "audio/ogg");
    const fake = openRouter({ transcription: [() => jsonResponse({ error: { code: 400, message: "bad audio" } }, 400)] });
    const history = await prepareMessagesForModel(await load([message.id]), context(fake));
    expect(conversions).toEqual([".ogg"]);
    expect(history[0]).toMatchObject({ transcriptFailed: true, transcript: null });
    expect((await row(message.id)).metadata).toMatchObject({ transcriptionFailed: true });
    expect(promptFor(history)).toEqual([{ role: "user", content: "[Nota de voz que no se ha podido transcribir: pide al cliente que te lo escriba]" }]);

    // Not tried again on the next turn.
    const before = fake.calls.length;
    await prepareMessagesForModel(await load([message.id]), context(fake));
    expect(fake.calls).toHaveLength(before);
  });

  it("the fallback model is tried only when all its providers are in the zero-retention list [CUM-10] [MED-02]", async () => {
    const privacy = {
      "GET /models/mistralai/voxtral-mini-transcribe/endpoints": () => jsonResponse(modelEndpointsBody("mistralai/voxtral-mini-transcribe", VOXTRAL_ENDPOINTS)),
      "GET /models/openai/whisper-large-v3-turbo/endpoints": () => jsonResponse(modelEndpointsBody("openai/whisper-large-v3-turbo", WHISPER_ENDPOINTS)),
      "GET /endpoints/zdr": () => jsonResponse(zdrEndpointsBody()),
    };
    const down = () => jsonResponse({ error: { code: 503, message: "No providers" } }, 503);
    const transcriptionModel = (fake: Fake) => callsTo(fake, "/audio/transcriptions").map((call) => (call.body as { model: string }).model);

    // Whisper (the default) fails: Voxtral keeps data with some provider, so it is not tried.
    const first = await mediaMessage("audio", OGG, "audio/ogg");
    const keeps = fakeFetch(routes({ ...privacy, "POST /audio/transcriptions": sequence(down, () => jsonResponse({ text: "Hola", usage: { seconds: 1, cost: 0 } })) }));
    const history = await prepareMessagesForModel(await load([first.id]), context(keeps));
    expect(history[0]).toMatchObject({ transcriptFailed: true });
    expect(transcriptionModel(keeps)).toEqual([DEFAULT_MODELS.transcription]);

    // Voxtral chosen in Settings (the owner saw the warning): Whisper, with every provider private, is its fallback.
    await db.update(integrationSettings).set({ defaultModels: { transcription: "mistralai/voxtral-mini-transcribe" } });
    const second = await mediaMessage("audio", OGG, "audio/ogg");
    const zdr = fakeFetch(routes({ ...privacy, "POST /audio/transcriptions": sequence(down, () => jsonResponse({ text: "Hola", usage: { seconds: 1, cost: 0 } })) }));
    const again = await prepareMessagesForModel(await load([second.id]), context(zdr));
    expect(again[0]).toMatchObject({ transcript: "Hola" });
    expect(transcriptionModel(zdr)).toEqual(["mistralai/voxtral-mini-transcribe", DEFAULT_MODELS.transcription]);
  });

  it("an audio over 25 MB is not sent to transcription", async () => {
    const message = await mediaMessage("audio", OGG, "audio/ogg");
    const media = { ...(message.media as MessageMedia), size: MEDIA_LIMITS.audioBytes + 1 };
    await db.update(messages).set({ media }).where(eq(messages.id, message.id));
    const fake = openRouter();
    const history = await prepareMessagesForModel(await load([message.id]), context(fake));
    expect(history[0]).toMatchObject({ transcriptFailed: true });
    expect(callsTo(fake, "/audio/transcriptions")).toHaveLength(0);
  });

  it("a stored file that is gone does not break the turn", async () => {
    const message = await createMessage(conversation, {
      contentType: "audio",
      text: null,
      media: { fileKey: "media/2026/09/00000000-0000-4000-8000-000000000000.ogg", mimeType: "audio/ogg", size: 10 },
    });
    const fake = openRouter();
    const history = await prepareMessagesForModel(await load([message.id]), context(fake));
    expect(history[0]).toMatchObject({ transcriptFailed: true });
    expect(callsTo(fake, "/audio/transcriptions")).toHaveLength(0);
  });

  it("without an OpenRouter key nothing is sent and nothing is marked as failed", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const message = await mediaMessage("audio", OGG, "audio/ogg");
    const fake = openRouter();
    const history = await prepareMessagesForModel(await load([message.id]), context(fake));
    expect(history[0]).toMatchObject({ transcript: null });
    expect(history[0].transcriptFailed).toBeFalsy();
    expect(fake.calls).toHaveLength(0);
    expect((await row(message.id)).metadata).toEqual({});
  });
});

describe("images [MED-05]", () => {
  it("go to the model as they are when it sees images", async () => {
    const message = await mediaMessage("image", PNG_1X1, "image/png");
    const fake = openRouter();
    const history = await prepareMessagesForModel(await load([message.id]), context(fake));
    expect(callsTo(fake, "/chat/completions")).toHaveLength(0);
    const expectedPart: ContentPart = { type: "image_url", image_url: { url: `data:image/png;base64,${Buffer.from(PNG_1X1).toString("base64")}` } };
    expect(promptFor(history)).toEqual([{ role: "user", content: [{ type: "text", text: "[Imagen]" }, expectedPart] }]);
  });

  it("are described by the cheap vision model when the agent's model does not see them; the description is kept", async () => {
    const message = await mediaMessage("image", PNG_1X1, "image/png");
    const fake = openRouter();
    const history = await prepareMessagesForModel(await load([message.id]), context(fake, { support: TEXT_ONLY }));
    expect(promptFor(history)).toEqual([{ role: "user", content: "[Imagen: Foto de un recogido con trenzas.]" }]);
    const [call] = callsTo(fake, "/chat/completions");
    expect((call.body as { model: string }).model).toBe(DEFAULT_MODELS.imageDescription);
    expect((await row(message.id)).metadata).toMatchObject({ imageDescription: "Foto de un recogido con trenzas." });
    const [run] = await db.select().from(aiRuns);
    expect(run).toMatchObject({ kind: "image_description", messageId: message.id });

    await prepareMessagesForModel(await load([message.id]), context(fake, { support: TEXT_ONLY }));
    expect(callsTo(fake, "/chat/completions")).toHaveLength(1);
  });

  it("the model's abilities come from the catalogue when not given", async () => {
    const message = await mediaMessage("image", PNG_1X1, "image/png");
    const fake = openRouter();
    // In the sample catalogue this model only reads text.
    await prepareMessagesForModel(await load([message.id]), context(fake, { model: "meta/llama-no-tools" }));
    expect(callsTo(fake, "/models/user").length).toBeGreaterThan(0);
    expect(callsTo(fake, "/chat/completions")).toHaveLength(1);
  });

  it("only the newest images travel as images; older ones as their saved description", async () => {
    const ids: string[] = [];
    for (let index = 0; index < 4; index += 1) ids.push((await mediaMessage("image", PNG_1X1, "image/png")).id);
    await db.update(messages).set({ metadata: { imageDescription: "Una foto antigua" } }).where(eq(messages.id, ids[0]));
    const fake = openRouter();
    const history = await prepareMessagesForModel(await load(ids), context(fake));
    expect(history.map((message) => message.parts?.length ?? 0)).toEqual([0, 1, 1, 1]);
    expect(history[0].mediaDescription).toBe("Una foto antigua");
  });
});

describe("documents [MED-06] and other files [MED-07]", () => {
  it("a PDF goes as a file to a model that opens PDFs", async () => {
    const pdf = makePdf(["Presupuesto de boda: 450 euros"]);
    const message = await mediaMessage("document", pdf, "application/pdf", { fileName: "presupuesto.pdf" });
    const history = await prepareMessagesForModel(await load([message.id]), context(openRouter(), { support: SEES_ALL }));
    expect(promptFor(history)).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "[Documento «presupuesto.pdf»]" },
          { type: "file", file: { filename: "presupuesto.pdf", file_data: `data:application/pdf;base64,${Buffer.from(pdf).toString("base64")}` } },
        ],
      },
    ]);
  });

  it("a PDF goes as its text to a model that does not open PDFs", async () => {
    const message = await mediaMessage("document", makePdf(["Presupuesto de boda: 450 euros"]), "application/pdf", { fileName: "presupuesto.pdf" });
    const history = await prepareMessagesForModel(await load([message.id]), context(openRouter(), { support: TEXT_ONLY }));
    expect(history[0].documentText).toContain("Presupuesto de boda: 450 euros");
    const [prompt] = promptFor(history);
    expect(prompt.content).toMatch(/^\[Documento «presupuesto\.pdf»\]\n\[Texto del documento\]\nPresupuesto de boda: 450 euros/);
  });

  it("other files are only named: the agent knows one arrived", async () => {
    const video = await mediaMessage("video", new TextEncoder().encode("fake-mp4"), "video/mp4");
    const sheet = await mediaMessage("document", new TextEncoder().encode("fake-xlsx"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", {
      fileName: "tarifas.xlsx",
    });
    const fake = openRouter();
    const history = await prepareMessagesForModel(await load([video.id, sheet.id]), context(fake));
    expect(promptFor(history)).toEqual([
      { role: "user", content: "[El cliente ha enviado un archivo de tipo vídeo]" },
      { role: "user", content: "[Documento «tarifas.xlsx»]" },
    ]);
    expect(fake.calls.filter((call) => call.method === "POST")).toHaveLength(0);
  });

  it("the team's own files are not processed", async () => {
    const sent = await mediaMessage("image", PNG_1X1, "image/png", { senderType: "human" });
    const fake = openRouter();
    const history = await prepareMessagesForModel(await load([sent.id]), context(fake));
    expect(history[0].parts).toBeUndefined();
    expect(fake.calls).toHaveLength(0);
  });
});

describe("a file of another conversation never reaches the model [WEB-11] [MED-08]", () => {
  it("a key already used in another conversation is ignored", async () => {
    const { contact } = await createContactWithIdentity("webchat");
    const other = await createConversation(channelId, contact.id);
    const theirs = await mediaMessage("image", PNG_1X1, "image/png", { conversationId: other.id });
    const copied = await createMessage(conversation, { contentType: "image", text: null, media: theirs.media });
    const fake = openRouter();
    const history = await prepareMessagesForModel(await load([copied.id]), context(fake, { support: TEXT_ONLY }));
    expect(promptFor(history)).toEqual([{ role: "user", content: "[Imagen]" }]);
    expect(fake.calls).toHaveLength(0);
  });
});
