// «Enviar como cliente» of the channel simulator ([AJU-12], [AJU-13]): the Server Action reads the form, goes through
// the real ingest pipeline (never a shortcut) and runs the background work afterwards. Owner and admin only.
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { auditLog, contactIdentities, contacts, conversations, jobs, messages, rateLimits, realtimeEvents } from "@/db/schema";
import type { Role } from "@/lib/enums";
import type { Actor } from "@/lib/permissions";
import { createAgentRow, createBusiness, createChannel, createUser, type TestUser } from "@/test/factories";

const state = vi.hoisted(() => ({ actor: null as Actor | null }));
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
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
// The real pipeline, watched; the work that follows is not run in tests.
vi.mock("@/server/inbound/ingest", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/inbound/ingest")>();
  return { ...original, ingestEvents: vi.fn(original.ingestEvents), kickTick: vi.fn() };
});
// Files stay in memory: tests never write into the project's data/uploads.
const stored = vi.hoisted(() => new Map<string, string>());
vi.mock("@/server/adapters/file-storage", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/adapters/file-storage")>();
  const memory = {
    kind: "disk" as const,
    put: async (key: string, data: Uint8Array, contentType: string) => {
      stored.set(key, contentType);
      return { key, size: data.byteLength };
    },
    get: async () => null,
    delete: async (key: string) => {
      stored.delete(key);
    },
    exists: async (key: string) => stored.has(key),
  };
  return { ...original, getFileStorage: () => memory };
});

import { ingestEvents, kickTick } from "@/server/inbound/ingest";
import { simulateMessageAction } from "./actions";

const FORBIDDEN = { ok: false, error: "No tienes permiso para hacer esto." };

function form(fields: Record<string, string | File>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

let owner: TestUser;
let admin: TestUser;
let channelId: string;

beforeAll(async () => {
  await createBusiness({ name: "Peluquería Lola", sector: "peluqueria" });
  owner = await createUser("owner");
  admin = await createUser("admin");
  const agent = await createAgentRow({ name: "Recepción" });
  channelId = (await createChannel({ type: "whatsapp", name: "WhatsApp", isDemo: true, activeAgentId: agent.id })).id;
});

beforeEach(async () => {
  for (const table of [messages, conversations, contactIdentities, contacts, jobs, realtimeEvents, auditLog, rateLimits]) await db.delete(table);
  stored.clear();
  vi.mocked(ingestEvents).mockClear();
  vi.mocked(kickTick).mockClear();
  state.actor = owner.actor;
});

describe("simulador: Enviar como cliente [AJU-12]", () => {
  it("goes through the real ingest pipeline, marked as simulated, and runs the reply work right after", async () => {
    const result = await simulateMessageAction(undefined, form({ channelId, contactMode: "new", name: "Ana Pruebas", phone: "600 111 222", contentType: "text", text: "¿Abrís el sábado?" }));
    expect(result).toMatchObject({ ok: true, message: "Mensaje recibido.", data: { channelName: "WhatsApp", contactName: "Ana Pruebas", duplicate: false } });
    if (!result.ok || !result.data) throw new Error("sin datos");

    expect(ingestEvents).toHaveBeenCalledTimes(1);
    const [channel, events, options] = vi.mocked(ingestEvents).mock.calls[0];
    expect(channel.id).toBe(channelId);
    expect(events).toEqual([expect.objectContaining({ kind: "inbound_message", simulated: true, contentType: "text", text: "¿Abrís el sábado?" })]);
    // No raw webhook: the simulator is not a webhook ([CAN-09]).
    expect(options?.raw).toBeUndefined();

    const [job] = await db.select().from(jobs);
    expect(kickTick).toHaveBeenCalledWith({ maxDurationSec: 60, runAt: job.runAt });
    const [message] = await db.select().from(messages);
    expect(message).toMatchObject({ simulated: true, conversationId: result.data.conversationId });
    expect(result.data.aiExpected).toBe(false);
    expect(result.data.aiReason).toMatch(/clave de OpenRouter/);
  });

  it("a voice note of one's own is read from the form, checked by its content and stored", async () => {
    const ogg = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const result = await simulateMessageAction(
      undefined,
      form({ channelId, contactMode: "new", contentType: "audio", fileSource: "upload", file: new File([ogg], "nota.ogg", { type: "audio/ogg" }) }),
    );
    expect(result.ok).toBe(true);
    const [message] = await db.select().from(messages);
    expect(message).toMatchObject({ contentType: "audio", media: expect.objectContaining({ mimeType: "audio/ogg", fileName: "nota.ogg", size: ogg.byteLength }) });
    expect([...stored.values()]).toEqual(["audio/ogg"]);
  });

  it("the ready-made image is attached when no file is uploaded", async () => {
    const result = await simulateMessageAction(undefined, form({ channelId, contactMode: "new", contentType: "image", fileSource: "sample", text: "¿Me hacéis este color?" }));
    expect(result.ok).toBe(true);
    const [message] = await db.select().from(messages);
    expect(message).toMatchObject({ contentType: "image", text: "¿Me hacéis este color?", media: expect.objectContaining({ mimeType: "image/png", fileName: "foto.png" }) });
  });

  it("[SEG-13] a file over 1 MB or missing is refused before anything is stored", async () => {
    const big = new File([new Uint8Array(1_000_001)], "grande.pdf", { type: "application/pdf" });
    expect(await simulateMessageAction(undefined, form({ channelId, contactMode: "new", contentType: "document", fileSource: "upload", file: big }))).toEqual({
      ok: false,
      error: "Revisa los campos marcados.",
      fieldErrors: { file: ["El archivo puede ocupar como mucho 1 MB."] },
    });
    expect(await simulateMessageAction(undefined, form({ channelId, contactMode: "new", contentType: "document", fileSource: "upload" }))).toMatchObject({
      ok: false,
      fieldErrors: { file: ["Elige un archivo."] },
    });
    expect(ingestEvents).not.toHaveBeenCalled();
    expect(stored.size).toBe(0);
  });

  it("[AJU-15] an invalid form comes back with the error next to its field, and nothing is stored", async () => {
    expect(await simulateMessageAction(undefined, form({ channelId, contactMode: "new", contentType: "text" }))).toMatchObject({ ok: false, fieldErrors: { text: ["Escribe el mensaje."] } });
    expect(await simulateMessageAction(undefined, form({ channelId, contactMode: "existing", contentType: "text", text: "Hola" }))).toMatchObject({ ok: false, fieldErrors: { contact: expect.any(Array) } });
    expect(await simulateMessageAction(undefined, form({ channelId: "no-es-un-id", contactMode: "new", contentType: "text", text: "Hola" }))).toMatchObject({ ok: false, fieldErrors: { channelId: expect.any(Array) } });
    expect(await db.select().from(messages)).toEqual([]);
  });

  it("an admin can use it too", async () => {
    state.actor = admin.actor;
    expect((await simulateMessageAction(undefined, form({ channelId, contactMode: "new", contentType: "text", text: "Hola" }))).ok).toBe(true);
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, "simulator.message_sent"));
    expect(entry.actorUserId).toBe(admin.userId);
  });
});

describe.each<Role>(["supervisor", "agent", "viewer"])("simulador as %s [PER-03] [PER-04] [SEG-04]", (role) => {
  it("is refused and nothing is stored, not even the file", async () => {
    state.actor = (await createUser(role)).actor;
    const ogg = new File([new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 0, 0, 0, 0, 0, 0, 0])], "nota.ogg");
    expect(await simulateMessageAction(undefined, form({ channelId, contactMode: "new", contentType: "text", text: "Hola" }))).toEqual(FORBIDDEN);
    expect(await simulateMessageAction(undefined, form({ channelId, contactMode: "new", contentType: "audio", fileSource: "upload", file: ogg }))).toEqual(FORBIDDEN);
    expect(ingestEvents).not.toHaveBeenCalled();
    expect(await db.select().from(messages)).toEqual([]);
    expect(stored.size).toBe(0);
  });
});

describe("simulador without a session", () => {
  it("asks to sign in again and does nothing", async () => {
    state.actor = null;
    expect(await simulateMessageAction(undefined, form({ channelId, contactMode: "new", contentType: "text", text: "Hola" }))).toEqual({ ok: false, error: "Tu sesión ha caducado. Vuelve a entrar." });
    expect(ingestEvents).not.toHaveBeenCalled();
  });
});
