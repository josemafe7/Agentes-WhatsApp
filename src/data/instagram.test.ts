// Instagram channels in the data layer ([IG-01], [IG-09]–[IG-11], [PER-04], [PER-07]): connecting an account, its panel,
// «Revalidar», «Cambiar token» and «Desconectar». The database and the Instagram code are real; Instagram's Graph API is
// a small fake of its documented answers (docs/integracion-instagram.md §2–§4), so nothing leaves the test.
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { appKv, auditLog, channels, jobs, notifications, rateLimits } from "@/db/schema";
import type { Role } from "@/lib/enums";
import { readInstagramConfig, readInstagramSecrets } from "@/server/channels/instagram/config";
import { INSTAGRAM_HEALTH_CHECK_JOB } from "@/server/channels/instagram/schedule";
import { AuthError, ConflictError, NotFoundError, RateLimitError, ValidationError } from "@/server/errors";
import { actorFor, createAgentRow, createBusiness, createChannel } from "@/test/factories";
import { changeInstagramToken, connectInstagramChannel, disconnectInstagramChannel, getInstagramPanel, revalidateInstagramChannel, type ConnectInstagramResult } from "./instagram";

// ─── A fake Graph API of Instagram ──────────────────────────────────────────────────────────────────────

const BASE_URL = "https://graph.instagram.test";
/** Tokens and secrets are put together at runtime: no literal may look like a real key to secret scanners. */
const fake = (prefix: string, seed: string) => `${prefix}${seed.repeat(8)}`;
const TOKEN = fake("IGAA", "FALSOPRUEBA");
const NEW_TOKEN = fake("IGAA", "NUEVOPRUEBA");
const OTHER_TOKEN = fake("IGAA", "OTRACUENTAX");
const APP_SECRET = fake("igsecret", "a1b2c3");
const META_APP_SECRET = fake("metasecret", "d4e5f6");
const ACCOUNT = { user_id: "17840000000000001", id: "9000000000000002", username: "peluqueria_aurora", name: "Peluquería Aurora", account_type: "BUSINESS" };
const OTHER_ACCOUNT = { user_id: "17840000000000099", id: "9000000000000098", username: "otra_cuenta", name: "Otra", account_type: "BUSINESS" };

type Call = { route: string; query: URLSearchParams; authorization: string | null };
type Handler = (call: Call) => Response;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** Graph's error body (§3), with its code and subcode. */
const graphError = (status: number, code: number, subcode?: number) => json({ error: { message: "Error de prueba", type: "OAuthException", code, ...(subcode ? { error_subcode: subcode } : {}) } }, status);

/** Answers by «METHOD /path» like Graph does; a route that is not stubbed answers 501, so a missing one is loud. */
function instagram(overrides: Record<string, Handler> = {}) {
  const calls: Call[] = [];
  const routes: Record<string, Handler> = {
    "GET /v25.0/me": (call) => json(call.authorization === `Bearer ${OTHER_TOKEN}` ? OTHER_ACCOUNT : ACCOUNT),
    "POST /v25.0/me/subscribed_apps": () => json({ success: true }),
    "GET /refresh_access_token": () => json({ access_token: NEW_TOKEN, token_type: "bearer", expires_in: 5_184_000 }),
    ...overrides,
  };
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.origin !== BASE_URL) throw new Error(`Llamada fuera del Instagram simulado: ${url.origin}`);
    const route = `${(init?.method ?? "GET").toUpperCase()} ${url.pathname}`;
    const call: Call = { route, query: url.searchParams, authorization: new Headers(init?.headers).get("authorization") };
    calls.push(call);
    const handler = routes[route];
    return handler ? handler(call) : json({ error: { message: `No simulado: ${route}`, code: 1 } }, 501);
  }) as typeof fetch;
  return { calls, deps: { fetchImpl, baseUrl: BASE_URL } };
}

// ─── Helpers ────────────────────────────────────────────────────────────────────────────────────────────

const owner = actorFor("owner");
const admin = actorFor("admin");
const NOT_MANAGERS: Role[] = ["supervisor", "agent", "viewer"];

const form = (overrides: Record<string, unknown> = {}) => ({ name: "Instagram Peluquería", accessToken: TOKEN, appSecret: APP_SECRET, metaAppSecret: META_APP_SECRET, ...overrides });

async function connect(overrides: Record<string, unknown> = {}, handlers?: Record<string, Handler>): Promise<Extract<ConnectInstagramResult, { status: "connected" }>> {
  const result = await connectInstagramChannel(owner, form(overrides), instagram(handlers).deps);
  if (result.status !== "connected") throw new Error(`no conectada: ${JSON.stringify(result)}`);
  return result;
}

const row = async (channelId: string) => (await db.select().from(channels).where(eq(channels.id, channelId)))[0];
const pendingJobs = (type: string) => db.select().from(jobs).where(and(eq(jobs.type, type), eq(jobs.status, "pending")));

beforeEach(async () => {
  for (const table of [notifications, jobs, appKv, rateLimits, auditLog]) await db.delete(table);
  await db.delete(channels);
  await createBusiness();
});

// ─── Connecting ─────────────────────────────────────────────────────────────────────────────────────────

describe("connecting an account [IG-01] [CAN-17] [SEG-02]", () => {
  it("[IG-01] checks the token, subscribes the account to its messages and stores every secret encrypted, never in config", async () => {
    const { calls, deps } = instagram();
    const agent = await createAgentRow();
    const result = await connectInstagramChannel(owner, form({ activeAgentId: agent.id }), deps);
    expect(result).toMatchObject({
      status: "connected",
      account: { username: ACCOUNT.username, name: ACCOUNT.name, link: `https://www.instagram.com/${ACCOUNT.username}/` },
      publicUrl: false,
    });
    if (result.status !== "connected") return;
    // The webhook address of this account and its verify token, to paste in Meta's panel.
    expect(result.webhookUrl).toBe(`http://localhost:3000/api/webhooks/instagram/${result.channelId}`);
    expect(result.verifyToken).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    // The token and the secrets never come back to the browser.
    for (const secret of [TOKEN, APP_SECRET, META_APP_SECRET]) expect(JSON.stringify(result)).not.toContain(secret);

    // The token goes as «Authorization: Bearer», never in the address; the account is subscribed to «messages».
    expect(calls[0]).toMatchObject({ route: "GET /v25.0/me", authorization: `Bearer ${TOKEN}` });
    expect(calls[0].query.has("access_token")).toBe(false);
    const subscribe = calls.find((call) => call.route === "POST /v25.0/me/subscribed_apps");
    expect(subscribe?.query.get("subscribed_fields")?.split(",")).toContain("messages");

    const channel = await row(result.channelId);
    expect(channel).toMatchObject({ type: "instagram", name: "Instagram Peluquería", status: "connected", replyMode: "auto", aiEnabled: true, activeAgentId: agent.id, isDemo: false });
    expect(readInstagramConfig(channel.config)).toMatchObject({ accountId: ACCOUNT.user_id, username: ACCOUNT.username, accountName: ACCOUNT.name, refreshFailures: 0 });
    const stored = JSON.stringify(channel.config);
    for (const secret of [TOKEN, APP_SECRET, META_APP_SECRET, result.verifyToken]) {
      expect(stored).not.toContain(secret);
      expect(channel.secretsEnc).not.toContain(secret);
    }
    expect(readInstagramSecrets(channel)).toEqual({ accessToken: TOKEN, appSecret: APP_SECRET, metaAppSecret: META_APP_SECRET, verifyToken: result.verifyToken });

    // Checked every 6 hours from now on, and its lights are already there ([IG-10]).
    expect(await pendingJobs(INSTAGRAM_HEALTH_CHECK_JOB)).toHaveLength(1);
    expect(channel.lastHealth?.checks.map((check) => check.key)).toEqual(["token", "expiry", "receiving", "last_message"]);
    expect(await db.select().from(auditLog)).toEqual([expect.objectContaining({ action: "channel.connected", targetId: result.channelId })]);
  });

  it("[IG-01] the Meta app secret is optional", async () => {
    const result = await connect({ metaAppSecret: "" });
    expect(readInstagramSecrets(await row(result.channelId))?.metaAppSecret).toBeNull();
  });

  it("[IG-01] [IG-12] a token Instagram refuses stores nothing and says why in Spanish", async () => {
    const refused = instagram({ "GET /v25.0/me": () => graphError(400, 190) });
    const result = await connectInstagramChannel(owner, form(), refused.deps);
    expect(result).toEqual({
      status: "invalid",
      error: "El token de Instagram no es válido o ha caducado.",
      action: expect.stringMatching(/Genera un token nuevo/),
    });
    // Nothing was subscribed nor stored.
    expect(refused.calls.map((call) => call.route)).toEqual(["GET /v25.0/me"]);
    expect(await db.select().from(channels)).toHaveLength(0);
    expect(await db.select().from(auditLog)).toHaveLength(0);
  });

  it("[IG-01] an account Instagram does not subscribe to its messages (success: false) is refused with what to do, and nothing is stored", async () => {
    const unsubscribed = instagram({ "POST /v25.0/me/subscribed_apps": () => json({ success: false }) });
    const result = await connectInstagramChannel(owner, form(), unsubscribed.deps);
    expect(result).toEqual({
      status: "invalid",
      error: "Instagram no ha suscrito la cuenta a sus mensajes.",
      action: expect.stringMatching(/instagram_business_manage_messages/),
    });
    expect(unsubscribed.calls.map((call) => call.route)).toEqual(["GET /v25.0/me", "POST /v25.0/me/subscribed_apps"]);
    expect(await db.select().from(channels)).toHaveLength(0);
    expect(await db.select().from(auditLog)).toHaveLength(0);
  });

  it("[IG-01] a personal account is refused before subscribing it, with what to do", async () => {
    const personal = instagram({ "GET /v25.0/me": () => json({ ...ACCOUNT, account_type: "PERSONAL" }) });
    const result = await connectInstagramChannel(owner, form(), personal.deps);
    expect(result).toMatchObject({ status: "invalid", error: expect.stringMatching(/no es profesional/), action: expect.stringMatching(/cuenta profesional/) });
    expect(personal.calls.map((call) => call.route)).toEqual(["GET /v25.0/me"]);
    expect(await db.select().from(channels)).toHaveLength(0);
  });

  it("[SEG-05] what does not look like a token or a key is refused field by field, without calling Instagram", async () => {
    const { calls, deps } = instagram();
    await expect(connectInstagramChannel(owner, form({ accessToken: "  " }), deps)).rejects.toMatchObject({ fieldErrors: { accessToken: ["Pega el token de la cuenta."] } });
    await expect(connectInstagramChannel(owner, form({ accessToken: "dos palabras" }), deps)).rejects.toMatchObject({ fieldErrors: { accessToken: ["El token no lleva espacios: cópialo entero."] } });
    await expect(connectInstagramChannel(owner, form({ appSecret: "corta" }), deps)).rejects.toMatchObject({ fieldErrors: { appSecret: ["Pega la clave secreta entera."] } });
    await expect(connectInstagramChannel(owner, form({ name: "" }), deps)).rejects.toMatchObject({ fieldErrors: { name: ["Escribe el nombre."] } });
    await expect(connectInstagramChannel(owner, { ...form(), extra: true }, deps)).rejects.toBeInstanceOf(ValidationError);
    expect(calls).toHaveLength(0);
    expect(await db.select().from(channels)).toHaveLength(0);
  });

  it("[IG-11] the same account is connected once in the installation", async () => {
    await connect();
    await expect(connectInstagramChannel(owner, form({ name: "Otra vez" }), instagram().deps)).rejects.toThrow(ConflictError);
    expect(await db.select().from(channels)).toHaveLength(1);
    // Another account is another channel.
    expect((await connectInstagramChannel(owner, form({ name: "Otra cuenta", accessToken: OTHER_TOKEN }), instagram().deps)).status).toBe("connected");
    expect(await db.select().from(channels)).toHaveLength(2);
  });

  it("[IG-01] connecting the same channel again keeps its verify token, so Meta's panel needs no change; another account's token is refused", async () => {
    const { channelId, verifyToken } = await connect();
    await disconnectInstagramChannel(owner, channelId);
    const again = await connectInstagramChannel(owner, form({ channelId, name: "Instagram Peluquería" }), instagram().deps);
    // A disconnected channel lost its secrets: its verify token is a new one, and it stays from then on.
    if (again.status !== "connected") throw new Error("no conectada");
    expect(again.channelId).toBe(channelId);
    const third = await connectInstagramChannel(owner, form({ channelId, name: "Instagram Peluquería", accessToken: NEW_TOKEN }), instagram().deps);
    expect(third).toMatchObject({ status: "connected", channelId, verifyToken: again.verifyToken });
    expect(again.verifyToken).not.toBe(verifyToken);
    expect(await db.select().from(channels)).toHaveLength(1);
    expect((await row(channelId)).status).toBe("connected");
    expect((await db.select().from(auditLog)).map((entry) => entry.action)).toEqual(expect.arrayContaining(["channel.connected", "channel.disconnected", "channel.reconnected"]));

    await expect(connectInstagramChannel(owner, form({ channelId, accessToken: OTHER_TOKEN }), instagram().deps)).rejects.toThrow(/es de otra cuenta \(@otra_cuenta\)/);
    expect(readInstagramSecrets(await row(channelId))?.accessToken).toBe(NEW_TOKEN);
  });

  it("[INT-03] an internal agent cannot answer the account: nothing is created", async () => {
    const internal = await createAgentRow({ audience: "team", systemTools: [] });
    await expect(connectInstagramChannel(owner, form({ activeAgentId: internal.id }), instagram().deps)).rejects.toBeInstanceOf(ValidationError);
    expect(await db.select().from(channels)).toHaveLength(0);
  });

  it("[SEG-07] checks with Instagram have a limit per person", async () => {
    const { deps } = instagram({ "GET /v25.0/me": () => graphError(400, 190) });
    let limited = false;
    for (let attempt = 0; attempt < 40 && !limited; attempt++) {
      limited = await connectInstagramChannel(owner, form(), deps).then(
        () => false,
        (error: unknown) => {
          if (error instanceof RateLimitError) return true;
          throw error;
        },
      );
    }
    expect(limited).toBe(true);
  });
});

// ─── Panel ──────────────────────────────────────────────────────────────────────────────────────────────

describe("the account's panel [IG-09] [IG-10] [PER-07]", () => {
  it("[PER-07] owner and admin see the token masked and the verify token; Solo lectura sees neither; supervisor and agent do not enter", async () => {
    const { channelId, verifyToken, webhookUrl } = await connect();
    const panel = await getInstagramPanel(owner, channelId);
    expect(panel).toMatchObject({ status: "connected", isDemo: false, hasCredentials: true, account: { username: ACCOUNT.username }, webhookUrl, verifyToken, webhookVerifiedAt: null });
    expect(panel.maskedToken).toMatch(/^••••.{4}$/);
    expect(JSON.stringify(panel)).not.toContain(TOKEN);
    expect(JSON.stringify(panel)).not.toContain(APP_SECRET);
    // [IG-09] the token pasted by hand lasts 60 days from then.
    const days = ((panel.tokenExpiresAt?.getTime() ?? 0) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(59);
    expect(days).toBeLessThanOrEqual(60);
    expect(await getInstagramPanel(admin, channelId)).toMatchObject({ maskedToken: panel.maskedToken, verifyToken });

    const viewer = await getInstagramPanel(actorFor("viewer"), channelId);
    expect(viewer).toMatchObject({ maskedToken: null, verifyToken: null, hasCredentials: true });
    expect(JSON.stringify(viewer)).not.toContain(verifyToken);
    for (const role of ["supervisor", "agent"] as const) await expect(getInstagramPanel(actorFor(role), channelId)).rejects.toThrow(AuthError);
  });

  it("a channel of another type is not an Instagram panel", async () => {
    const webchat = await createChannel();
    await expect(getInstagramPanel(owner, webchat.id)).rejects.toThrow(NotFoundError);
    await expect(getInstagramPanel(owner, "no-es-un-id")).rejects.toThrow(NotFoundError);
  });

  it("[IG-13] [ARR-11] a demo account only shows itself: no secrets, no verify token, and nothing to do with Instagram", async () => {
    const demo = await createChannel({ type: "instagram", name: "Instagram", isDemo: true, config: { username: "peluqueria_aurora.demo", accountName: "Peluquería Aurora" } });
    const { calls, deps } = instagram();
    expect(await getInstagramPanel(owner, demo.id)).toMatchObject({ isDemo: true, account: { username: "peluqueria_aurora.demo" }, hasCredentials: false, verifyToken: null, maskedToken: null, tokenExpiresAt: null });
    await expect(revalidateInstagramChannel(owner, demo.id, deps)).rejects.toThrow(NotFoundError);
    await expect(changeInstagramToken(owner, demo.id, { accessToken: NEW_TOKEN }, deps)).rejects.toThrow(NotFoundError);
    await expect(disconnectInstagramChannel(owner, demo.id, deps)).rejects.toThrow(NotFoundError);
    expect(calls).toHaveLength(0);
  });

  it("[IG-10] «Revalidar» checks the token again, subscribes the account again and refreshes the lights", async () => {
    const { channelId } = await connect();
    await db.update(channels).set({ status: "error", lastHealth: null }).where(eq(channels.id, channelId));
    const { calls, deps } = instagram();
    expect(await revalidateInstagramChannel(owner, channelId, deps)).toEqual({ ok: true, warning: null });
    expect(calls.map((call) => call.route)).toContain("POST /v25.0/me/subscribed_apps");
    const channel = await row(channelId);
    expect(channel.status).toBe("connected");
    expect(channel.lastHealth?.checks.map((check) => check.key)).toEqual(["token", "expiry", "receiving", "last_message"]);
    expect(readInstagramSecrets(channel)?.accessToken).toBe(TOKEN);

    // A token Instagram no longer accepts changes nothing and says why.
    const refused = await revalidateInstagramChannel(owner, channelId, instagram({ "GET /v25.0/me": () => graphError(400, 190) }).deps);
    expect(refused).toMatchObject({ ok: false, error: expect.stringMatching(/token de Instagram no es válido/) });
    expect(readInstagramSecrets(await row(channelId))?.accessToken).toBe(TOKEN);

    // A switched-off channel is switched on first.
    await db.update(channels).set({ status: "disabled" }).where(eq(channels.id, channelId));
    await expect(revalidateInstagramChannel(owner, channelId, instagram().deps)).rejects.toThrow(ConflictError);
  });

  it("[IG-10] «Cambiar token»: only a token Instagram accepts and of the same account replaces the old one", async () => {
    const { channelId, verifyToken } = await connect();
    const before = readInstagramSecrets(await row(channelId));

    const other = await changeInstagramToken(owner, channelId, { accessToken: OTHER_TOKEN }, instagram().deps);
    expect(other).toMatchObject({ ok: false, error: expect.stringMatching(/es de otra cuenta \(@otra_cuenta\)/) });
    const refused = await changeInstagramToken(owner, channelId, { accessToken: NEW_TOKEN }, instagram({ "GET /v25.0/me": () => graphError(400, 190) }).deps);
    expect(refused.ok).toBe(false);
    expect(readInstagramSecrets(await row(channelId))).toEqual(before);

    expect(await changeInstagramToken(owner, channelId, { accessToken: NEW_TOKEN }, instagram().deps)).toMatchObject({ ok: true });
    // Only the token changes: the app secrets and the verify token stay, so Meta's panel needs nothing.
    expect(readInstagramSecrets(await row(channelId))).toEqual({ accessToken: NEW_TOKEN, appSecret: APP_SECRET, metaAppSecret: META_APP_SECRET, verifyToken });
    await expect(changeInstagramToken(owner, channelId, { accessToken: "" }, instagram().deps)).rejects.toMatchObject({ fieldErrors: { accessToken: ["Pega el token de la cuenta."] } });
  });
});

// ─── Disconnecting ──────────────────────────────────────────────────────────────────────────────────────

describe("«Desconectar» [IG-10]", () => {
  it("deletes the token and the keys, stops its checks and leaves the channel «desactivado» with its account's name", async () => {
    const { channelId } = await connect();
    const { calls, deps } = instagram();
    await disconnectInstagramChannel(owner, channelId, deps);
    // Nothing to ask Instagram: the secrets are simply erased.
    expect(calls).toHaveLength(0);
    const channel = await row(channelId);
    expect(channel).toMatchObject({ status: "disabled", secretsEnc: null });
    expect(readInstagramConfig(channel.config)).toMatchObject({ username: ACCOUNT.username, webhookVerifiedAt: null });
    expect(await pendingJobs(INSTAGRAM_HEALTH_CHECK_JOB)).toHaveLength(0);
    expect(await getInstagramPanel(owner, channelId)).toMatchObject({ hasCredentials: false, verifyToken: null, maskedToken: null, tokenExpiresAt: null });
    expect((await db.select().from(auditLog)).map((entry) => entry.action)).toContain("channel.disconnected");
    // Without its token, «Cambiar token» sends to the wizard.
    await expect(changeInstagramToken(owner, channelId, { accessToken: NEW_TOKEN }, instagram().deps)).rejects.toThrow(/vuelve a conectarla con el asistente de Instagram/);
  });
  it("[IG-11] its account cannot go to a new channel: it says to reconnect it from its own panel, keeping its conversations", async () => {
    const { channelId } = await connect();
    await disconnectInstagramChannel(owner, channelId, instagram().deps);
    await expect(connectInstagramChannel(owner, form({ name: "Otra vez" }), instagram().deps)).rejects.toThrow(/canal desconectado «Instagram Peluquería»: vuelve a conectarla desde su panel/);
  });
});

describe("the channel's name [BAN-17]", () => {
  it("left with the type's name, the channel is called as its account, so the inbox says «Instagram · @cuenta»", async () => {
    const { channelId } = await connect({ name: "Instagram" });
    expect((await row(channelId)).name).toBe(`@${ACCOUNT.username}`);
  });
});

// ─── Permissions ────────────────────────────────────────────────────────────────────────────────────────

describe("who may do what [PER-04]", () => {
  it("only owner and admin connect, revalidate, change the token or disconnect; nobody else reaches Instagram", async () => {
    const { channelId } = await connect();
    expect((await connectInstagramChannel(admin, form({ channelId, name: "Por la admin" }), instagram().deps)).status).toBe("connected");
    for (const role of NOT_MANAGERS) {
      const actor = actorFor(role);
      const { calls, deps } = instagram();
      await expect(connectInstagramChannel(actor, form({ name: "Otro" }), deps)).rejects.toThrow(AuthError);
      await expect(revalidateInstagramChannel(actor, channelId, deps)).rejects.toThrow(AuthError);
      await expect(changeInstagramToken(actor, channelId, { accessToken: NEW_TOKEN }, deps)).rejects.toThrow(AuthError);
      await expect(disconnectInstagramChannel(actor, channelId, deps)).rejects.toThrow(AuthError);
      expect(calls).toHaveLength(0);
    }
    expect(await db.select().from(channels)).toHaveLength(1);
    expect(readInstagramSecrets(await row(channelId))?.accessToken).toBe(TOKEN);
    // The agent role does not even see the panel ([PER-03]).
    await expect(getInstagramPanel(actorFor("agent"), channelId)).rejects.toThrow(AuthError);
  });
});
