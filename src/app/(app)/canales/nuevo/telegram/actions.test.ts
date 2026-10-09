// The Telegram wizard and panel ([TG-01], [TG-04], [TG-05], [TG-07], [TG-08]): their Server Actions called directly, as
// an attacker could ([SEG-04]). The session is replaced; the data layer, the database and the Telegram code are real,
// and Telegram is the documented fake (global fetch + TELEGRAM_API_BASE_URL): nothing leaves the test.
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { auditLog, channels, jobs, rateLimits } from "@/db/schema";
import type { Role } from "@/lib/enums";
import type { Actor } from "@/lib/permissions";
import { readTelegramSecrets } from "@/server/channels/telegram/config";
import { actorFor, createBusiness } from "@/test/factories";
import { connectedBotRoutes, FAKE_TELEGRAM_BASE_URL, fakeTelegramFetch, TG_TEST, tgError, tgOk, webhookInfoResponse, type TelegramCall, type TelegramHandler } from "@/test/fixtures/telegram";

const state = vi.hoisted(() => ({ actor: null as Actor | null }));

vi.mock("@/server/session", async () => {
  const { AuthError } = await import("@/server/errors");
  const { can } = await import("@/lib/permissions");
  const requireActor = async () => {
    if (!state.actor) throw new AuthError("unauthenticated");
    return state.actor;
  };
  return {
    requireActor,
    requirePermission: async (action: Parameters<typeof can>[1]) => {
      const actor = await requireActor();
      if (!can(actor, action)) throw new AuthError("forbidden");
      return actor;
    },
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { changeTelegramTokenAction, disconnectTelegramAction, revalidateTelegramAction } from "../../[id]/_telegram/actions";
import { connectTelegramAction } from "./actions";

const FORBIDDEN = { ok: false, error: "No tienes permiso para hacer esto." };
let calls: TelegramCall[];

/** Telegram answers with `handler` for the rest of the test. */
function telegram(handler: TelegramHandler = connectedBotRoutes()): void {
  const fake = fakeTelegramFetch(handler);
  calls = fake.calls;
  vi.stubGlobal("fetch", fake.fetch);
}

const form = (overrides: Record<string, unknown> = {}) => ({ name: "Telegram Peluquería", botToken: TG_TEST.botToken, ...overrides });
const tokenForm = (botToken: string) => {
  const data = new FormData();
  data.append("botToken", botToken);
  return data;
};

async function connected(): Promise<string> {
  const result = await connectTelegramAction(form());
  if (!result.ok || result.data?.status !== "connected") throw new Error(`no conectado: ${JSON.stringify(result)}`);
  return result.data.channelId;
}

beforeEach(async () => {
  for (const table of [jobs, auditLog, rateLimits]) await db.delete(table);
  await db.delete(channels);
  await createBusiness();
  state.actor = actorFor("owner");
  vi.stubEnv("TELEGRAM_API_BASE_URL", FAKE_TELEGRAM_BASE_URL);
  telegram();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("permisos de Telegram [PER-04] [PER-03] [SEG-04]", () => {
  it.each<Role>(["supervisor", "agent", "viewer"])("%s cannot use any action: nothing changes and Telegram is never called", async (role) => {
    const channelId = await connected();
    const before = (await db.select().from(channels))[0];
    calls.length = 0;
    state.actor = actorFor(role);
    const results = [
      await connectTelegramAction(form({ name: "Otro" })),
      await revalidateTelegramAction(channelId),
      await changeTelegramTokenAction(channelId, undefined, tokenForm(TG_TEST.newBotToken)),
      await disconnectTelegramAction(channelId),
    ];
    for (const result of results) expect(result).toEqual(FORBIDDEN);
    expect(calls).toHaveLength(0);
    expect(await db.select().from(channels)).toEqual([before]);
  });

  it("without a session nothing is done", async () => {
    state.actor = null;
    expect(await connectTelegramAction(form())).toMatchObject({ ok: false, error: "Tu sesión ha caducado. Vuelve a entrar." });
    expect(await db.select().from(channels)).toHaveLength(0);
  });
});

describe("asistente de Telegram [TG-01] [TG-05] [TG-07]", () => {
  it("«Conectar» returns the bot with the QR code of its link, and never its token [SEG-02]", async () => {
    const result = await connectTelegramAction(form());
    expect(result).toMatchObject({ ok: true, data: { status: "connected", bot: { username: TG_TEST.botUsername, link: `https://t.me/${TG_TEST.botUsername}` }, mode: "polling" } });
    if (!result.ok || result.data?.status !== "connected") return;
    expect(result.data.botQr).toMatch(/^data:image\/png;base64,/);
    expect(Number.isNaN(Date.parse(result.data.connectedAt))).toBe(false);
    expect(JSON.stringify(result)).not.toContain(TG_TEST.botToken);
  });

  it("a refused token and a bot that is already somewhere else come back as answers, with nothing stored", async () => {
    telegram(connectedBotRoutes({ getMe: () => tgError(401, "Unauthorized") }));
    expect(await connectTelegramAction(form())).toMatchObject({ ok: true, data: { status: "invalid" } });
    telegram(connectedBotRoutes({ getWebhookInfo: () => tgOk(webhookInfoResponse({ url: "https://otra.example/hook" })) }));
    expect(await connectTelegramAction(form())).toMatchObject({ ok: true, data: { status: "needs_confirmation", otherHost: "otra.example" } });
    expect(await db.select().from(channels)).toHaveLength(0);
    expect(await connectTelegramAction(form({ name: "" }))).toMatchObject({ ok: false, fieldErrors: { name: ["Escribe el nombre."] } });
    expect(await connectTelegramAction("no es un formulario")).toMatchObject({ ok: false });
  });
});

describe("panel de Telegram [TG-04] [TG-08]", () => {
  it("«Revalidar», «Cambiar token» and «Desconectar» do their work and say so in Spanish", async () => {
    const channelId = await connected();
    expect(await revalidateTelegramAction(channelId)).toMatchObject({ ok: true, message: "Revalidado con Telegram: los semáforos están al día." });
    expect(await changeTelegramTokenAction(channelId, undefined, tokenForm(TG_TEST.newBotToken))).toMatchObject({ ok: true, message: "Token cambiado y comprobado con Telegram." });
    const [row] = await db.select().from(channels).where(eq(channels.id, channelId));
    expect(readTelegramSecrets(row)?.botToken).toBe(TG_TEST.newBotToken);

    telegram(connectedBotRoutes({ getMe: () => tgError(401, "Unauthorized") }));
    const refused = await changeTelegramTokenAction(channelId, undefined, tokenForm(TG_TEST.botToken));
    expect(refused).toMatchObject({ ok: false, fieldErrors: { botToken: [expect.stringMatching(/token del bot no es válido/)] } });

    telegram();
    expect(await disconnectTelegramAction(channelId)).toMatchObject({ ok: true, data: { warning: null } });
    expect((await db.select().from(channels))[0]).toMatchObject({ status: "disabled", secretsEnc: null });
  });

  it("an id that is not one, or of another channel, is «no encontrado»", async () => {
    expect(await revalidateTelegramAction("no-es-un-id")).toEqual({ ok: false, error: "No se ha encontrado el canal." });
    expect(await disconnectTelegramAction(crypto.randomUUID())).toMatchObject({ ok: false });
    expect(await changeTelegramTokenAction(42, undefined, tokenForm(TG_TEST.botToken))).toEqual({ ok: false, error: "No se ha encontrado el canal." });
  });
});
