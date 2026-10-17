// The Instagram wizard and panel ([IG-01], [IG-10], [IG-11]): their Server Actions called directly, as an attacker could
// ([SEG-04]). The session is replaced; the data layer, the database and the Instagram code are real, and Instagram's
// Graph API is a small fake of its documented answers (global fetch + INSTAGRAM_GRAPH_BASE_URL): nothing leaves the test.
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { auditLog, channels, jobs, rateLimits } from "@/db/schema";
import type { Role } from "@/lib/enums";
import type { Actor } from "@/lib/permissions";
import { readInstagramSecrets, updateInstagramConfig } from "@/server/channels/instagram/config";
import { actorFor, createBusiness } from "@/test/factories";

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

import { changeInstagramTokenAction, disconnectInstagramAction, revalidateInstagramAction } from "../../[id]/_instagram/actions";
import { connectInstagramAction, instagramWebhookStatusAction } from "./actions";

const BASE_URL = "https://graph.instagram.test";
const fake = (prefix: string, seed: string) => `${prefix}${seed.repeat(8)}`;
const TOKEN = fake("IGAA", "FALSOPRUEBA");
const NEW_TOKEN = fake("IGAA", "NUEVOPRUEBA");
const APP_SECRET = fake("igsecret", "a1b2c3");
const ACCOUNT = { user_id: "17840000000000001", username: "peluqueria_aurora", name: "Peluquería Aurora", account_type: "BUSINESS" };
const FORBIDDEN = { ok: false, error: "No tienes permiso para hacer esto." };

let calls: string[];

/** Instagram answers `me` with `meStatus` (200 = the account) for the rest of the test. */
function instagram(meStatus = 200): void {
  calls = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.origin !== BASE_URL) throw new Error(`Llamada fuera del Instagram simulado: ${url.origin}`);
    const route = `${(init?.method ?? "GET").toUpperCase()} ${url.pathname}`;
    calls.push(route);
    if (route === "GET /v25.0/me") return meStatus === 200 ? json(ACCOUNT) : json({ error: { message: "Error de prueba", code: 190 } }, meStatus);
    if (route === "POST /v25.0/me/subscribed_apps") return json({ success: true });
    return json({ error: { message: `No simulado: ${route}`, code: 1 } }, 501);
  });
}

const form = (overrides: Record<string, unknown> = {}) => ({ name: "Instagram Peluquería", accessToken: TOKEN, appSecret: APP_SECRET, ...overrides });
const tokenForm = (accessToken: string) => {
  const data = new FormData();
  data.append("accessToken", accessToken);
  return data;
};

async function connected(): Promise<string> {
  const result = await connectInstagramAction(form());
  if (!result.ok || result.data?.status !== "connected") throw new Error(`no conectada: ${JSON.stringify(result)}`);
  return result.data.channelId;
}

beforeEach(async () => {
  for (const table of [jobs, auditLog, rateLimits]) await db.delete(table);
  await db.delete(channels);
  await createBusiness();
  state.actor = actorFor("owner");
  vi.stubEnv("INSTAGRAM_GRAPH_BASE_URL", BASE_URL);
  instagram();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("permisos de Instagram [PER-04] [PER-03] [SEG-04]", () => {
  it.each<Role>(["supervisor", "agent", "viewer"])("%s cannot use any action: nothing changes and Instagram is never called", async (role) => {
    const channelId = await connected();
    const before = (await db.select().from(channels))[0];
    calls.length = 0;
    state.actor = actorFor(role);
    const results = [
      await connectInstagramAction(form({ name: "Otro" })),
      await instagramWebhookStatusAction(channelId),
      await revalidateInstagramAction(channelId),
      await changeInstagramTokenAction(channelId, undefined, tokenForm(NEW_TOKEN)),
      await disconnectInstagramAction(channelId),
    ];
    for (const result of results) expect(result).toEqual(FORBIDDEN);
    expect(calls).toHaveLength(0);
    expect(await db.select().from(channels)).toEqual([before]);
  });

  it("without a session nothing is done", async () => {
    state.actor = null;
    expect(await connectInstagramAction(form())).toMatchObject({ ok: false, error: "Tu sesión ha caducado. Vuelve a entrar." });
    expect(await db.select().from(channels)).toHaveLength(0);
  });
});

describe("asistente de Instagram [IG-01] [IG-11]", () => {
  it("[IG-01] «Conectar cuenta» returns the account, the webhook address and its verify token, and never the token nor the key [SEG-02]", async () => {
    const result = await connectInstagramAction(form());
    expect(result).toMatchObject({
      ok: true,
      data: { status: "connected", account: { username: ACCOUNT.username, link: `https://www.instagram.com/${ACCOUNT.username}/` }, publicUrl: false },
    });
    if (!result.ok || result.data?.status !== "connected") return;
    expect(result.data.webhookUrl).toMatch(new RegExp(`/api/webhooks/instagram/${result.data.channelId}$`));
    expect(result.data.verifyToken.length).toBeGreaterThanOrEqual(16);
    expect(Number.isNaN(Date.parse(result.data.connectedAt))).toBe(false);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(JSON.stringify(result)).not.toContain(APP_SECRET);
  });

  it("[IG-01] a refused token, a missing field and the same account twice come back as answers, with nothing more stored", async () => {
    instagram(400);
    expect(await connectInstagramAction(form())).toMatchObject({ ok: true, data: { status: "invalid", error: "El token de Instagram no es válido o ha caducado." } });
    expect(await db.select().from(channels)).toHaveLength(0);
    instagram();
    expect(await connectInstagramAction(form({ appSecret: "" }))).toMatchObject({ ok: false, fieldErrors: { appSecret: ["Pega la clave secreta entera."] } });
    expect(await connectInstagramAction("no es un formulario")).toMatchObject({ ok: false });
    await connected();
    // [IG-11] the same account, again.
    expect(await connectInstagramAction(form({ name: "Otra vez" }))).toMatchObject({ ok: false, error: "Esta cuenta de Instagram ya está conectada en otro canal de la instalación." });
    expect(await db.select().from(channels)).toHaveLength(1);
  });

  it("[IG-01] «Avisos de Meta» says when Meta checked the address, and nothing for an id that is not one", async () => {
    const channelId = await connected();
    expect(await instagramWebhookStatusAction(channelId)).toEqual({ ok: true, data: { verifiedAt: null } });
    const at = new Date("2026-10-16T09:30:00Z");
    await updateInstagramConfig(channelId, { webhookVerifiedAt: at.toISOString() });
    expect(await instagramWebhookStatusAction(channelId)).toEqual({ ok: true, data: { verifiedAt: at.toISOString() } });
    expect(await instagramWebhookStatusAction("no-es-un-id")).toEqual({ ok: false, error: "No se ha encontrado el canal." });
  });
});

describe("panel de Instagram [IG-10]", () => {
  it("«Revalidar», «Cambiar token» and «Desconectar» do their work and say so in Spanish", async () => {
    const channelId = await connected();
    expect(await revalidateInstagramAction(channelId)).toMatchObject({ ok: true, message: "Revalidado con Instagram: los semáforos están al día." });
    expect(calls).toContain("POST /v25.0/me/subscribed_apps");
    expect(await changeInstagramTokenAction(channelId, undefined, tokenForm(NEW_TOKEN))).toMatchObject({ ok: true, message: "Token cambiado y comprobado con Instagram." });
    const [row] = await db.select().from(channels).where(eq(channels.id, channelId));
    expect(readInstagramSecrets(row)?.accessToken).toBe(NEW_TOKEN);

    instagram(400);
    const refused = await changeInstagramTokenAction(channelId, undefined, tokenForm(TOKEN));
    expect(refused).toMatchObject({ ok: false, fieldErrors: { accessToken: [expect.stringMatching(/token de Instagram no es válido/)] } });

    instagram();
    expect(await disconnectInstagramAction(channelId)).toMatchObject({ ok: true, message: "Cuenta desconectada: el canal queda desactivado y conserva sus conversaciones." });
    expect((await db.select().from(channels))[0]).toMatchObject({ status: "disabled", secretsEnc: null });
  });

  it("an id that is not one, or of another channel, is «no encontrado»", async () => {
    expect(await revalidateInstagramAction("no-es-un-id")).toEqual({ ok: false, error: "No se ha encontrado el canal." });
    expect(await disconnectInstagramAction(crypto.randomUUID())).toMatchObject({ ok: false });
    expect(await changeInstagramTokenAction(42, undefined, tokenForm(TOKEN))).toEqual({ ok: false, error: "No se ha encontrado el canal." });
  });
});
