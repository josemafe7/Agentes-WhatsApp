import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { appKv, auditLog, channels, jobs, notifications, rateLimits } from "@/db/schema";
import type { Role } from "@/lib/enums";
import { readTelegramConfig, readTelegramSecrets, telegramWebhookUrl } from "@/server/channels/telegram/config";
import { TELEGRAM_HEALTH_CHECK_JOB, TELEGRAM_POLL_JOB } from "@/server/channels/telegram/schedule";
import { AuthError, ConflictError, NotFoundError, RateLimitError } from "@/server/errors";
import { actorFor, createAgentRow, createBusiness, createChannel } from "@/test/factories";
import { botResponse, connectedBotRoutes, fakeTelegramFetch, TG_TEST, tgError, tgOk, webhookInfoResponse, type TelegramHandler } from "@/test/fixtures/telegram";
import { updateChannel } from "./channels";
import { changeTelegramToken, connectTelegramChannel, disconnectTelegramChannel, getTelegramPanel, revalidateTelegramChannel, type ConnectTelegramResult } from "./telegram";

const owner = actorFor("owner");
const admin = actorFor("admin");
const NOT_MANAGERS: Role[] = ["supervisor", "agent", "viewer"];
const PUBLIC_URL = "https://agentes.peluqueria-ejemplo.es";

const form = (overrides: Record<string, unknown> = {}) => ({ name: "Telegram Peluquería", botToken: TG_TEST.botToken, ...overrides });

function telegram(handler: TelegramHandler = connectedBotRoutes()) {
  const fake = fakeTelegramFetch(handler);
  return { calls: fake.calls, deps: fake.deps };
}

async function connect(overrides: Record<string, unknown> = {}, handler?: TelegramHandler): Promise<Extract<ConnectTelegramResult, { status: "connected" }>> {
  const result = await connectTelegramChannel(owner, form(overrides), telegram(handler).deps);
  if (result.status !== "connected") throw new Error(`no conectado: ${JSON.stringify(result)}`);
  return result;
}

const row = async (channelId: string) => (await db.select().from(channels).where(eq(channels.id, channelId)))[0];
const pendingJobs = (type: string) => db.select().from(jobs).where(and(eq(jobs.type, type), eq(jobs.status, "pending")));

beforeEach(async () => {
  for (const table of [notifications, jobs, appKv, rateLimits, auditLog]) await db.delete(table);
  await db.delete(channels);
  await createBusiness();
});
afterEach(() => vi.unstubAllEnvs());

describe("connecting a bot [TG-01] [CAN-17]", () => {
  it("with a public address: checks the token, stores it encrypted and gives Telegram the channel's webhook with its secret", async () => {
    vi.stubEnv("APP_URL", PUBLIC_URL);
    let webhookUrl = "";
    const { calls, deps } = telegram(
      connectedBotRoutes({
        setWebhook: (call) => {
          webhookUrl = (call.body as { url: string }).url;
          return tgOk(true);
        },
        getWebhookInfo: () => tgOk(webhookInfoResponse({ url: webhookUrl })),
      }),
    );
    const agent = await createAgentRow();
    const result = await connectTelegramChannel(owner, form({ activeAgentId: agent.id }), deps);
    expect(result).toMatchObject({ status: "connected", mode: "webhook", warning: null, bot: { username: TG_TEST.botUsername, name: TG_TEST.botName, link: `https://t.me/${TG_TEST.botUsername}` } });
    if (result.status !== "connected") return;
    // The token never comes back to the browser ([SEG-02]).
    expect(JSON.stringify(result)).not.toContain(TG_TEST.botToken);

    const channel = await row(result.channelId);
    expect(channel).toMatchObject({ type: "telegram", name: "Telegram Peluquería", status: "connected", replyMode: "auto", aiEnabled: true, activeAgentId: agent.id, testMode: false });
    expect(readTelegramConfig(channel.config)).toMatchObject({ botId: TG_TEST.botId, botUsername: TG_TEST.botUsername, receiveMode: "webhook" });
    expect(JSON.stringify(channel.config)).not.toContain(TG_TEST.botToken);
    expect(channel.secretsEnc).not.toContain(TG_TEST.botToken);
    const secrets = readTelegramSecrets(channel);
    expect(secrets?.botToken).toBe(TG_TEST.botToken);

    const setWebhook = calls.find((call) => call.method === "setWebhook");
    expect(setWebhook?.body).toEqual({ url: telegramWebhookUrl(result.channelId), secret_token: secrets?.webhookSecret, allowed_updates: ["message"] });
    expect(webhookUrl).toBe(`${PUBLIC_URL}/api/webhooks/telegram/${result.channelId}`);
    expect(secrets?.webhookSecret).toMatch(/^[A-Za-z0-9_-]{20,256}$/);
    expect(await pendingJobs(TELEGRAM_HEALTH_CHECK_JOB)).toHaveLength(1);
    expect(await pendingJobs(TELEGRAM_POLL_JOB)).toHaveLength(0);
    expect(await db.select().from(auditLog)).toEqual([expect.objectContaining({ action: "channel.connected", targetId: result.channelId })]);
  });

  it("without a public address (on this computer) the bot has no webhook and the app asks for the messages itself [TG-06]", async () => {
    const { calls, deps } = telegram();
    const result = await connectTelegramChannel(owner, form(), deps);
    expect(result).toMatchObject({ status: "connected", mode: "polling", warning: null });
    if (result.status !== "connected") return;
    expect(calls.some((call) => call.method === "deleteWebhook")).toBe(true);
    expect(calls.some((call) => call.method === "setWebhook")).toBe(false);
    const channel = await row(result.channelId);
    expect(channel.status).toBe("connected");
    expect(readTelegramConfig(channel.config).receiveMode).toBe("polling");
    expect(await pendingJobs(TELEGRAM_POLL_JOB)).toHaveLength(1);
  });

  it("a token Telegram refuses, or one that does not look like a token, stores nothing and says why", async () => {
    const refused = await connectTelegramChannel(owner, form(), telegram(connectedBotRoutes({ getMe: () => tgError(401, "Unauthorized") })).deps);
    expect(refused).toMatchObject({ status: "invalid" });
    if (refused.status === "invalid") expect(refused.error).toMatch(/token del bot no es válido/);
    const odd = telegram();
    expect(await connectTelegramChannel(owner, form({ botToken: "esto no es un token" }), odd.deps)).toMatchObject({ status: "invalid" });
    expect(odd.calls).toHaveLength(0);
    await expect(connectTelegramChannel(owner, form({ botToken: "  " }), odd.deps)).rejects.toMatchObject({ fieldErrors: { botToken: ["Pega el token del bot."] } });
    await expect(connectTelegramChannel(owner, form({ name: "" }), odd.deps)).rejects.toMatchObject({ fieldErrors: { name: ["Escribe el nombre."] } });
    expect(await db.select().from(channels)).toHaveLength(0);
  });

  it("an agent that does not exist is refused before anything is stored", async () => {
    await expect(connectTelegramChannel(owner, form({ activeAgentId: crypto.randomUUID() }), telegram().deps)).rejects.toMatchObject({ fieldErrors: { activeAgentId: ["Ese agente no existe."] } });
    expect(await db.select().from(channels)).toHaveLength(0);
  });

  it("the same bot is connected once in the installation [TG-05]", async () => {
    await connect();
    await expect(connectTelegramChannel(owner, form({ name: "Otra vez" }), telegram().deps)).rejects.toThrow(ConflictError);
    expect(await db.select().from(channels)).toHaveLength(1);
  });

  it("a bot that already sends its updates elsewhere is only taken after confirming [TG-05]", async () => {
    const elsewhere = () => connectedBotRoutes({ getWebhookInfo: () => tgOk(webhookInfoResponse({ url: "https://n8n.otro-sitio.example/webhook/secreto-123" })) });
    const asked = telegram(elsewhere());
    const result = await connectTelegramChannel(owner, form(), asked.deps);
    expect(result).toEqual({ status: "needs_confirmation", bot: { username: TG_TEST.botUsername, name: TG_TEST.botName, link: `https://t.me/${TG_TEST.botUsername}` }, otherHost: "n8n.otro-sitio.example" });
    // Only the host: the rest of that address may be a secret of the other tool.
    expect(JSON.stringify(result)).not.toContain("secreto-123");
    expect(asked.calls.map((call) => call.method)).toEqual(["getMe", "getWebhookInfo"]);
    expect(await db.select().from(channels)).toHaveLength(0);

    const confirmed = await connectTelegramChannel(owner, form({ confirmReplace: true }), telegram(connectedBotRoutes()).deps);
    expect(confirmed.status).toBe("connected");
  });

  it("if Telegram cannot be told how to deliver, the bot is kept in «error» with the reason, to retry with «Revalidar»", async () => {
    vi.stubEnv("APP_URL", "https://agentes.peluqueria-ejemplo.es:3000");
    const result = await connectTelegramChannel(owner, form(), telegram(connectedBotRoutes({ setWebhook: () => tgError(400, "Bad Request: bad webhook: Webhook can be set up only on ports 80, 88, 443 or 8443") })).deps);
    expect(result).toMatchObject({ status: "connected", mode: "webhook" });
    if (result.status !== "connected") return;
    expect(result.warning).toMatch(/puerto 443, 80, 88 u 8443/);
    const channel = await row(result.channelId);
    expect(channel.status).toBe("error");
    expect(channel.lastHealth?.error).toBe(result.warning);
    expect(readTelegramSecrets(channel)).not.toBeNull();
  });

  it("only owner and admin connect, change the token, revalidate or disconnect [PER-04]", async () => {
    const { channelId } = await connect();
    expect((await connectTelegramChannel(admin, form({ channelId, name: "Por la admin" }), telegram().deps)).status).toBe("connected");
    for (const role of NOT_MANAGERS) {
      const actor = actorFor(role);
      const { calls, deps } = telegram();
      await expect(connectTelegramChannel(actor, form({ name: "Otro" }), deps)).rejects.toThrow(AuthError);
      await expect(revalidateTelegramChannel(actor, channelId, deps)).rejects.toThrow(AuthError);
      await expect(changeTelegramToken(actor, channelId, { botToken: TG_TEST.newBotToken }, deps)).rejects.toThrow(AuthError);
      await expect(disconnectTelegramChannel(actor, channelId, deps)).rejects.toThrow(AuthError);
      expect(calls).toHaveLength(0);
    }
    expect(await db.select().from(channels)).toHaveLength(1);
    expect(readTelegramSecrets(await row(channelId))?.botToken).toBe(TG_TEST.botToken);
  });

  it("checks with Telegram have a limit per person [SEG-07]", async () => {
    const { deps } = telegram(connectedBotRoutes({ getMe: () => tgError(401, "Unauthorized") }));
    let limited = false;
    for (let attempt = 0; attempt < 40 && !limited; attempt++) {
      limited = await connectTelegramChannel(owner, form(), deps).then(
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

describe("the bot's panel [TG-07] [TG-08] [PER-07]", () => {
  it("owner and admin see the token masked; Solo lectura sees the panel without it; the rest do not enter", async () => {
    const { channelId } = await connect();
    const panel = await getTelegramPanel(owner, channelId);
    expect(panel).toMatchObject({ bot: { username: TG_TEST.botUsername, link: `https://t.me/${TG_TEST.botUsername}` }, receiveMode: "polling", hasCredentials: true, status: "connected" });
    expect(panel.maskedToken).toMatch(/^••••.{4}$/);
    expect(JSON.stringify(panel)).not.toContain(TG_TEST.botToken);
    expect((await getTelegramPanel(admin, channelId)).maskedToken).toBe(panel.maskedToken);
    const viewer = await getTelegramPanel(actorFor("viewer"), channelId);
    expect(viewer).toMatchObject({ maskedToken: null, hasCredentials: true });
    for (const role of ["supervisor", "agent"] as const) await expect(getTelegramPanel(actorFor(role), channelId)).rejects.toThrow(AuthError);
  });

  it("a channel of another type is not a Telegram panel", async () => {
    const webchat = await createChannel();
    await expect(getTelegramPanel(owner, webchat.id)).rejects.toThrow(NotFoundError);
    await expect(getTelegramPanel(owner, "no-es-un-id")).rejects.toThrow(NotFoundError);
  });

  it("«Revalidar» brings the bot's messages back to this installation and refreshes the lights", async () => {
    const { channelId } = await connect();
    await db.update(channels).set({ status: "error", lastHealth: null }).where(eq(channels.id, channelId));
    const { calls, deps } = telegram();
    expect(await revalidateTelegramChannel(owner, channelId, deps)).toEqual({ ok: true, mode: "polling", warning: null });
    expect(calls.map((call) => call.method)).toContain("deleteWebhook");
    const channel = await row(channelId);
    expect(channel.status).toBe("connected");
    expect(channel.lastHealth?.checks.map((check) => check.key)).toEqual(["token", "receiving", "last_message"]);
  });

  it("«Revalidar» with a token Telegram no longer accepts changes nothing and says why", async () => {
    const { channelId } = await connect();
    const result = await revalidateTelegramChannel(owner, channelId, telegram(connectedBotRoutes({ getMe: () => tgError(401, "Unauthorized") })).deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/token del bot no es válido/);
    expect(readTelegramSecrets(await row(channelId))?.botToken).toBe(TG_TEST.botToken);
  });

  it("«Cambiar token»: only a token Telegram accepts and of the same bot replaces the old one", async () => {
    const { channelId } = await connect();
    const before = readTelegramSecrets(await row(channelId));
    const other = await changeTelegramToken(owner, channelId, { botToken: TG_TEST.otherBotToken }, telegram(connectedBotRoutes({ getMe: () => tgOk(botResponse({ id: 7000000002, username: "otro_bot" })) })).deps);
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.error).toMatch(/es de otro bot \(@otro_bot\)/);
    const refused = await changeTelegramToken(owner, channelId, { botToken: TG_TEST.newBotToken }, telegram(connectedBotRoutes({ getMe: () => tgError(401, "Unauthorized") })).deps);
    expect(refused.ok).toBe(false);
    expect(readTelegramSecrets(await row(channelId))).toEqual(before);

    expect(await changeTelegramToken(owner, channelId, { botToken: TG_TEST.newBotToken }, telegram().deps)).toMatchObject({ ok: true });
    const after = readTelegramSecrets(await row(channelId));
    expect(after).toEqual({ botToken: TG_TEST.newBotToken, webhookSecret: before?.webhookSecret });
    await expect(changeTelegramToken(owner, channelId, { botToken: "" }, telegram().deps)).rejects.toMatchObject({ fieldErrors: { botToken: ["Pega el token del bot."] } });
  });
});

describe("«Desconectar» [TG-04]", () => {
  it("removes the webhook in Telegram, deletes the token, stops its jobs and leaves the channel «desactivado»", async () => {
    const { channelId } = await connect();
    const { calls, deps } = telegram();
    expect(await disconnectTelegramChannel(owner, channelId, deps)).toEqual({ warning: null });
    expect(calls.map((call) => call.method)).toEqual(["deleteWebhook"]);
    const channel = await row(channelId);
    expect(channel).toMatchObject({ status: "disabled", secretsEnc: null });
    expect(readTelegramConfig(channel.config)).toMatchObject({ botUsername: TG_TEST.botUsername, receiveMode: null, updateOffset: null });
    expect(await pendingJobs(TELEGRAM_POLL_JOB)).toHaveLength(0);
    expect(await pendingJobs(TELEGRAM_HEALTH_CHECK_JOB)).toHaveLength(0);
    expect((await getTelegramPanel(owner, channelId)).hasCredentials).toBe(false);
  });

  it("the token is deleted even if Telegram cannot be reached, and the person is told", async () => {
    const { channelId } = await connect();
    const result = await disconnectTelegramChannel(owner, channelId, telegram(connectedBotRoutes({ deleteWebhook: () => tgError(502, "Bad Gateway") })).deps);
    expect(result.warning).toMatch(/No se ha podido quitar/);
    expect((await row(channelId)).secretsEnc).toBeNull();
  });

  it("a disconnected bot is not switched on with «Activar»: it is connected again with its wizard, keeping its channel", async () => {
    const { channelId } = await connect();
    await disconnectTelegramChannel(owner, channelId, telegram().deps);
    await expect(updateChannel(owner, channelId, { enabled: true })).rejects.toThrow(/vuelve a conectarlo con el asistente de Telegram/);
    const again = await connectTelegramChannel(owner, form({ channelId, name: "Telegram Peluquería" }), telegram().deps);
    expect(again).toMatchObject({ status: "connected", channelId });
    expect(await db.select().from(channels)).toHaveLength(1);
    expect((await row(channelId)).status).toBe("connected");
    expect((await db.select().from(auditLog)).map((entry) => entry.action)).toEqual(expect.arrayContaining(["channel.connected", "channel.disconnected", "channel.reconnected"]));
  });

  it("a bot switched off and on again is checked with Telegram [CAN-16]", async () => {
    const { channelId } = await connect();
    await updateChannel(owner, channelId, { enabled: false });
    expect((await row(channelId)).status).toBe("disabled");
    await db.delete(jobs);
    await updateChannel(owner, channelId, { enabled: true });
    expect((await row(channelId)).status).toBe("connecting");
    expect(await pendingJobs(TELEGRAM_HEALTH_CHECK_JOB)).toHaveLength(1);
  });
});
