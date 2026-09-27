// The media path end to end through the real reply job: what arrives by a channel is prepared for the model
// before the agent answers ([MOT-04]). OpenRouter is faked; files go to a temporary folder.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ storageDir: "" }));
vi.mock("@/server/adapters/file-storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/adapters/file-storage")>();
  let storage: InstanceType<typeof actual.DiskStorage> | undefined;
  return { ...actual, getFileStorage: () => (storage ??= new actual.DiskStorage(state.storageDir)) };
});

import { ensureSettingsRows } from "@/data/settings";
import { db } from "@/db";
import {
  agents,
  aiRuns,
  appKv,
  auditLog,
  businessHours,
  channels,
  contactIdentities,
  contacts,
  conversations,
  handoffEvents,
  integrationSettings,
  jobs,
  messages,
  notifications,
  realtimeEvents,
} from "@/db/schema";
import type { ChatMessage } from "@/lib/openrouter/types";
import { processReplyJob } from "@/server/engine/reply";
import { REPLY_JOB, replyJobPayload, type ReplyJobPayload } from "@/server/engine/schedule";
import { ingestEvents } from "@/server/inbound/ingest";
import { chatCompletion, FAKE_OPENROUTER_KEY, fakeFetch, jsonResponse, routes, sampleCatalog, type FakeCall } from "@/test/fake-openrouter";
import { createAgentRow, createBusiness, createChannel } from "@/test/factories";
import { storeInboundMedia } from "./store";
import { PNG_1X1 } from "./test-fixtures";

const NOW = new Date("2026-09-30T09:00:00Z");
const SENT_AT = new Date(NOW.getTime() - 5_000);
const WEBM = new TextEncoder().encode("webm-voice-note");

beforeAll(() => {
  state.storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "dominia-reply-media-"));
});
afterAll(() => fs.rmSync(state.storageDir, { recursive: true, force: true }));

beforeEach(async () => {
  for (const table of [notifications, handoffEvents, auditLog, aiRuns, messages, conversations, contactIdentities, contacts, jobs, realtimeEvents, appKv]) await db.delete(table);
  await db.update(channels).set({ activeAgentId: null });
  await db.delete(channels);
  await db.delete(agents);
  await db.delete(businessHours);
  await createBusiness({ timezone: "Europe/Madrid" });
  await ensureSettingsRows();
  await db.update(integrationSettings).set({ zdr: false, defaultModels: {} });
  vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
});
afterEach(() => vi.unstubAllEnvs());

function openRouter(said = "Quería una cita para el martes") {
  return fakeFetch(
    routes({
      "GET /models/user": () => jsonResponse({ data: sampleCatalog() }),
      "POST /audio/transcriptions": () => jsonResponse({ text: said, usage: { seconds: 3, cost: 0.00001 } }),
      "POST /chat/completions": () => jsonResponse(chatCompletion({ content: "¡Claro! ¿A qué hora te viene bien?" })),
    }),
  );
}

async function receiveFile(contentType: "audio" | "image", bytes: Uint8Array, mimeType: string, agentOverrides: Parameters<typeof createAgentRow>[0] = {}) {
  const agent = await createAgentRow({ name: "Recepción", ...agentOverrides });
  const channel = await createChannel({ type: "webchat", name: "Web", activeAgentId: agent.id });
  const media = await storeInboundMedia({ bytes, mimeType }, { prefix: "webchat" });
  const result = await ingestEvents(
    channel,
    [{ kind: "inbound_message", externalId: crypto.randomUUID(), sender: { externalIds: ["visitor-1"] }, contentType, text: null, media, sentAt: SENT_AT }],
    { now: SENT_AT },
  );
  return result.messages[0];
}

async function runReply(conversationId: string, fake: ReturnType<typeof openRouter>) {
  const [job] = await db.select().from(jobs).where(and(eq(jobs.type, REPLY_JOB), eq(jobs.dedupeKey, `reply:${conversationId}`)));
  const ctx = { job, rescheduleAt: () => undefined, remainingMs: () => 120_000 };
  return processReplyJob(replyJobPayload.parse(job.payload) as ReplyJobPayload, ctx, { fetchImpl: fake.fetch, now: NOW, retryDelayMs: 0 });
}

const lastUserTurn = (call: FakeCall) => (call.body as { messages: ChatMessage[] }).messages.filter((message) => message.role === "user").at(-1);

describe("files are prepared before the agent answers [MOT-04]", () => {
  it("a voice note is transcribed, saved under the player, and the agent answers the text [MED-01] [MED-04]", async () => {
    const received = await receiveFile("audio", WEBM, "audio/webm");
    const fake = openRouter();
    const outcome = await runReply(received.conversationId ?? "", fake);
    expect(outcome.kind).toBe("replied");

    const chat = fake.calls.find((call) => call.path === "/chat/completions");
    expect(lastUserTurn(chat as FakeCall)).toEqual({ role: "user", content: "[Nota de voz] Quería una cita para el martes" });
    const [stored] = await db.select().from(messages).where(eq(messages.id, received.messageId ?? ""));
    expect(stored.transcript).toBe("Quería una cita para el martes");
    const kinds = (await db.select({ kind: aiRuns.kind }).from(aiRuns)).map((run) => run.kind).sort();
    expect(kinds).toEqual(["chat", "transcription"]);
  });

  it("while the AI stays quiet (paused), the voice note is still transcribed for the team, with no chat call [MED-04]", async () => {
    const received = await receiveFile("audio", WEBM, "audio/webm");
    await db.update(conversations).set({ aiPausedUntil: new Date(NOW.getTime() + 3_600_000), pauseReason: "Ha respondido Eva" }).where(eq(conversations.id, received.conversationId ?? ""));
    const fake = openRouter();
    expect(await runReply(received.conversationId ?? "", fake)).toEqual({ kind: "skipped", reason: "paused" });
    const [stored] = await db.select().from(messages).where(eq(messages.id, received.messageId ?? ""));
    expect(stored.transcript).toBe("Quería una cita para el martes");
    expect(fake.calls.filter((call) => call.path === "/chat/completions")).toHaveLength(0);
  });

  it("the agent's hand-off rules also read what a voice note says [TRA-01]", async () => {
    const received = await receiveFile("audio", WEBM, "audio/webm", {
      handoff: { keywords: ["hablar con una persona"], messageInHours: "Te paso con el equipo.", messageOffHours: "Te paso con el equipo." },
    });
    const fake = openRouter("Hola, quiero hablar con una persona, por favor");
    const outcome = await runReply(received.conversationId ?? "", fake);
    expect(outcome).toMatchObject({ kind: "handed_off", rule: "keyword" });
    expect(fake.calls.filter((call) => call.path === "/chat/completions")).toHaveLength(0);
  });

  it("an image goes to an agent whose model sees images [MED-05]", async () => {
    const received = await receiveFile("image", PNG_1X1, "image/png");
    const fake = openRouter();
    expect((await runReply(received.conversationId ?? "", fake)).kind).toBe("replied");
    const chat = fake.calls.find((call) => call.path === "/chat/completions");
    expect(lastUserTurn(chat as FakeCall)).toEqual({
      role: "user",
      content: [
        { type: "text", text: "[Imagen]" },
        { type: "image_url", image_url: { url: `data:image/png;base64,${Buffer.from(PNG_1X1).toString("base64")}` } },
      ],
    });
  });
});
