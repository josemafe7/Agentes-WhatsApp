import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { appKv, auditLog, channels, jobs, notifications, rateLimits, whatsappTemplates } from "@/db/schema";
import type { Role } from "@/lib/enums";
import { readYCloudConfig, readYCloudSecrets, ycloudWebhookUrl } from "@/server/channels/ycloud/config";
import { YCLOUD_HEALTH_CHECK_JOB } from "@/server/channels/ycloud/schedule";
import { YCLOUD_TEMPLATES_SYNC_JOB } from "@/server/channels/ycloud/templates";
import { AuthError, ConflictError, NotFoundError, RateLimitError } from "@/server/errors";
import { actorFor, createAgentRow, createBusiness, createChannel } from "@/test/factories";
import { fakeYCloudFetch, phoneNumberResponse, YC_TEST, ycError, ycloudAccount, type FakeYCloudAccount } from "@/test/fixtures/ycloud";
import { deleteChannel, getChannel, listChannels, updateChannel } from "./channels";
import { runConnectionTest } from "./diagnostics-connections";
import { WHATSAPP_NUMBER_TAKEN } from "./whatsapp-numbers";
import {
  changeYCloudKey,
  checkYCloudKey,
  connectYCloudChannel,
  disconnectYCloudChannel,
  getYCloudPanel,
  revalidateYCloudChannel,
  syncYCloudTemplatesNow,
  YCLOUD_LOCAL_WARNING,
  type ConnectYCloudResult,
} from "./ycloud";

const owner = actorFor("owner");
const NOT_MANAGERS: Role[] = ["supervisor", "agent", "viewer"];
const PUBLIC_URL = "https://agentes.peluqueria-ejemplo.es";

const form = (overrides: Record<string, unknown> = {}) => ({ name: "WhatsApp Peluquería", apiKey: YC_TEST.apiKey, phoneNumber: YC_TEST.phoneNumber, ...overrides });

function ycloud(account: FakeYCloudAccount = ycloudAccount()) {
  const fake = fakeYCloudFetch(account.handler);
  return { account, calls: fake.calls, deps: fake.deps };
}

async function connect(overrides: Record<string, unknown> = {}, service = ycloud()): Promise<Extract<ConnectYCloudResult, { status: "connected" }>> {
  const result = await connectYCloudChannel(owner, form(overrides), service.deps);
  if (result.status !== "connected") throw new Error(`no conectado: ${JSON.stringify(result)}`);
  return result;
}

const row = async (channelId: string) => (await db.select().from(channels).where(eq(channels.id, channelId)))[0];
const pendingJobs = (type: string) => db.select().from(jobs).where(and(eq(jobs.type, type), eq(jobs.status, "pending")));

beforeEach(async () => {
  for (const table of [notifications, jobs, appKv, rateLimits, auditLog, whatsappTemplates]) await db.delete(table);
  await db.delete(channels);
  await createBusiness();
});
afterEach(() => vi.unstubAllEnvs());

describe("«Comprobar clave» [YC-02]", () => {
  it("lists the account's numbers with their state, marking the ones already in the installation [WA-11]", async () => {
    await createChannel({ type: "whatsapp", connectionMode: "manual", phoneNumberId: "200000000000001", displayPhoneNumber: "+34 600 33 34 44" });
    const service = ycloud(ycloudAccount({}, { numbers: [phoneNumberResponse(), phoneNumberResponse({ phoneNumber: YC_TEST.otherPhoneNumber, displayPhoneNumber: "+34 600 33 34 44", verifiedName: "Otra" })] }));
    const result = await checkYCloudKey(owner, { apiKey: YC_TEST.apiKey }, service.deps);
    expect(result).toMatchObject({
      ok: true,
      balance: { amount: 12.5, currency: "USD" },
      numbers: [
        { phoneNumber: YC_TEST.phoneNumber, displayPhoneNumber: YC_TEST.displayPhoneNumber, verifiedName: YC_TEST.verifiedName, status: "CONNECTED", qualityRating: "GREEN", taken: false },
        { phoneNumber: YC_TEST.otherPhoneNumber, taken: true },
      ],
    });
    expect(JSON.stringify(result)).not.toContain(YC_TEST.apiKey);
    // Nothing is stored by checking.
    expect(await db.select().from(channels)).toHaveLength(1);
  });

  it("a key YCloud refuses says why in Spanish and stores nothing", async () => {
    const service = ycloud(ycloudAccount({ "GET /balance": () => ycError(401, "UNAUTHORIZED") }));
    const result = await checkYCloudKey(owner, { apiKey: YC_TEST.apiKey }, service.deps);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(`${result.error} ${result.action}`).toMatch(/no acepta la clave.*Developers › API key/);
    expect(await connectYCloudChannel(owner, form(), service.deps)).toMatchObject({ status: "invalid" });
    expect(await db.select().from(channels)).toHaveLength(0);
  });

  it("only owner and admin, and with a limit per person [PER-04] [SEG-07]", async () => {
    for (const role of NOT_MANAGERS) await expect(checkYCloudKey(actorFor(role), { apiKey: YC_TEST.apiKey }, ycloud().deps)).rejects.toThrow(AuthError);
    const service = ycloud();
    for (let attempt = 0; attempt < 30; attempt++) await checkYCloudKey(owner, { apiKey: YC_TEST.apiKey }, service.deps);
    await expect(checkYCloudKey(owner, { apiKey: YC_TEST.apiKey }, service.deps)).rejects.toThrow(RateLimitError);
    expect(service.calls.filter((call) => call.path === "/balance")).toHaveLength(30);
  });
});

describe("connecting a number [YC-03] [YC-04] [WA-56]", () => {
  it("with a public address: stores the key encrypted and creates the channel's webhook endpoint in YCloud", async () => {
    vi.stubEnv("APP_URL", PUBLIC_URL);
    const service = ycloud();
    const agent = await createAgentRow();
    const result = await connect({ activeAgentId: agent.id }, service);
    expect(result).toMatchObject({ receiving: true, warning: null, number: { displayPhoneNumber: YC_TEST.displayPhoneNumber } });
    // The key never comes back to the browser ([SEG-02]).
    expect(JSON.stringify(result)).not.toContain(YC_TEST.apiKey);

    const channel = await row(result.channelId);
    expect(channel).toMatchObject({
      type: "whatsapp",
      connectionMode: "ycloud",
      name: "WhatsApp Peluquería",
      status: "connected",
      phoneNumberId: "ycloud:34600111222",
      wabaId: YC_TEST.wabaId,
      displayPhoneNumber: YC_TEST.displayPhoneNumber,
      verifiedName: YC_TEST.verifiedName,
      webhookStatus: "subscribed",
      activeAgentId: agent.id,
      // A number with conversations of its own starts answering nobody ([WA-56]).
      testMode: true,
      testAllowlist: [],
    });
    expect(readYCloudConfig(channel.config)).toMatchObject({ ycloudPhoneNumber: YC_TEST.phoneNumber, ycloudWebhookEndpointId: YC_TEST.endpointId, ycloudBalance: { amount: 12.5 } });
    expect(JSON.stringify(channel.config)).not.toContain(YC_TEST.apiKey);
    expect(channel.secretsEnc).not.toContain(YC_TEST.apiKey);
    expect(readYCloudSecrets(channel)).toEqual({ apiKey: YC_TEST.apiKey, webhookSecret: YC_TEST.webhookSecret });
    expect(service.account.endpoints.get(YC_TEST.endpointId)?.url).toBe(`${PUBLIC_URL}/api/webhooks/ycloud/${result.channelId}`);
    expect(ycloudWebhookUrl(result.channelId)).toBe(`${PUBLIC_URL}/api/webhooks/ycloud/${result.channelId}`);
    expect(channel.lastHealth?.checks.map((check) => [check.key, check.status])).toEqual([["key", "ok"], ["number", "ok"], ["webhook", "ok"], ["balance", "ok"], ["last_message", "off"]]);
    expect(await pendingJobs(YCLOUD_HEALTH_CHECK_JOB)).toHaveLength(1);
    expect(await pendingJobs(YCLOUD_TEMPLATES_SYNC_JOB)).toHaveLength(1);
    expect(await db.select().from(auditLog)).toEqual([expect.objectContaining({ action: "channel.connected", targetId: result.channelId })]);
    // The card and the panel say how the number is connected ([WA-54]).
    expect(await listChannels(owner)).toMatchObject([{ whatsappVia: "ycloud", whatsappNumber: YC_TEST.displayPhoneNumber, capabilities: { templates: true, window24h: true } }]);
  });

  it("without a public address (on this computer) the channel is stored and says nothing will arrive yet [YC-04]", async () => {
    const service = ycloud();
    const result = await connect({}, service);
    expect(result).toMatchObject({ receiving: false, warning: YCLOUD_LOCAL_WARNING });
    expect(service.calls.some((call) => call.path === "/webhookEndpoints")).toBe(false);
    const channel = await row(result.channelId);
    expect(channel).toMatchObject({ status: "connecting", webhookStatus: "not_subscribed" });
    expect(channel.lastHealth?.checks.find((check) => check.key === "webhook")).toMatchObject({ status: "warn" });
    expect(readYCloudSecrets(channel)).toEqual({ apiKey: YC_TEST.apiKey, webhookSecret: null });

    // Once the app is published, «Revalidar» creates the endpoint by itself.
    vi.stubEnv("APP_URL", PUBLIC_URL);
    expect(await revalidateYCloudChannel(owner, result.channelId, service.deps)).toEqual({ ok: true, receiving: true, warning: null });
    expect(await row(result.channelId)).toMatchObject({ status: "connected", webhookStatus: "subscribed" });
    expect(readYCloudSecrets(await row(result.channelId))?.webhookSecret).toBe(YC_TEST.webhookSecret);
  });

  it("a number is connected once in the installation, whatever the way [WA-11] [QR-05]", async () => {
    await connect();
    await expect(connectYCloudChannel(owner, form({ name: "Otra vez" }), ycloud().deps)).rejects.toThrow(WHATSAPP_NUMBER_TAKEN);
    await db.delete(channels);
    // The same number, already connected with Meta's own API.
    await createChannel({ type: "whatsapp", connectionMode: "manual", phoneNumberId: "200000000000001", displayPhoneNumber: YC_TEST.displayPhoneNumber });
    await expect(connectYCloudChannel(owner, form(), ycloud().deps)).rejects.toThrow(ConflictError);
    // A demo number never blocks a real one ([ARR-11]).
    await db.delete(channels);
    await createChannel({ type: "whatsapp", isDemo: true, displayPhoneNumber: YC_TEST.displayPhoneNumber });
    expect((await connect()).channelId).toBeTruthy();
  });

  it("a number that is not in the account, a missing agent or bad data store nothing", async () => {
    expect(await connectYCloudChannel(owner, form({ phoneNumber: "+34699000000" }), ycloud().deps)).toMatchObject({ status: "invalid", error: expect.stringMatching(/no está en esta cuenta/) });
    await expect(connectYCloudChannel(owner, form({ activeAgentId: crypto.randomUUID() }), ycloud().deps)).rejects.toMatchObject({ fieldErrors: { activeAgentId: ["Ese agente no existe."] } });
    await expect(connectYCloudChannel(owner, form({ name: "" }), ycloud().deps)).rejects.toMatchObject({ fieldErrors: { name: expect.any(Array) } });
    await expect(connectYCloudChannel(owner, { ...form(), otra: "cosa" }, ycloud().deps)).rejects.toThrow();
    for (const role of NOT_MANAGERS) await expect(connectYCloudChannel(actorFor(role), form(), ycloud().deps)).rejects.toThrow(AuthError);
    expect(await db.select().from(channels)).toHaveLength(0);
  });
});

describe("the panel [YC-09]", () => {
  it("shows the number, its lights and the key masked only to owner and admin [PER-07]", async () => {
    vi.stubEnv("APP_URL", PUBLIC_URL);
    const { channelId } = await connect();
    const panel = await getYCloudPanel(owner, channelId);
    expect(panel).toMatchObject({ displayPhoneNumber: YC_TEST.displayPhoneNumber, verifiedName: YC_TEST.verifiedName, canReceive: true, hasCredentials: true, balance: { amount: 12.5, currency: "USD" } });
    expect(panel.maskedKey).toMatch(/^•+.{4}$/);
    expect(JSON.stringify(panel)).not.toContain(YC_TEST.apiKey);
    expect((await getYCloudPanel(actorFor("viewer"), channelId)).maskedKey).toBeNull();
    await expect(getYCloudPanel(actorFor("agent"), channelId)).rejects.toThrow(AuthError);
    // What is Meta's own never applies to a number connected through YCloud ([WA-54]).
    const meta = await createChannel({ type: "whatsapp", connectionMode: "manual", phoneNumberId: "200000000000009" });
    await expect(getYCloudPanel(owner, meta.id)).rejects.toThrow(NotFoundError);
  });

  it("«Revalidar» recreates the webhook endpoint someone deleted in YCloud, and the lights say what fails", async () => {
    vi.stubEnv("APP_URL", PUBLIC_URL);
    const service = ycloud();
    const { channelId } = await connect({}, service);
    service.account.endpoints.clear();
    const result = await revalidateYCloudChannel(owner, channelId, service.deps);
    expect(result).toEqual({ ok: true, receiving: true, warning: null });
    const channel = await row(channelId);
    expect(readYCloudConfig(channel.config).ycloudWebhookEndpointId).toBe(`${YC_TEST.endpointId}2`);
    expect(readYCloudSecrets(channel)?.webhookSecret).toBe(`${YC_TEST.webhookSecret}2`);

    // The number banned: the channel goes to «error» and says so.
    const banned = ycloud(ycloudAccount({}, { numbers: [phoneNumberResponse({ status: "BANNED" })] }));
    banned.account.endpoints.set(`${YC_TEST.endpointId}2`, { id: `${YC_TEST.endpointId}2`, url: ycloudWebhookUrl(channelId), status: "active" });
    await revalidateYCloudChannel(owner, channelId, banned.deps);
    expect(await row(channelId)).toMatchObject({ status: "error", lastHealth: { error: expect.stringMatching(/BANNED/) } });
  });

  it("«Cambiar clave» only replaces the key if YCloud accepts it and it sees the same number", async () => {
    vi.stubEnv("APP_URL", PUBLIC_URL);
    const service = ycloud();
    const { channelId } = await connect({}, service);
    const refused = ycloud(ycloudAccount({ "GET /balance": () => ycError(401, "UNAUTHORIZED") }));
    expect(await changeYCloudKey(owner, channelId, { apiKey: YC_TEST.newApiKey }, refused.deps)).toMatchObject({ ok: false });
    const otherAccount = ycloud(ycloudAccount({}, { numbers: [phoneNumberResponse({ phoneNumber: YC_TEST.otherPhoneNumber })] }));
    expect(await changeYCloudKey(owner, channelId, { apiKey: YC_TEST.newApiKey }, otherAccount.deps)).toMatchObject({ ok: false, error: expect.stringMatching(/no ve el número/) });
    expect(readYCloudSecrets(await row(channelId))?.apiKey).toBe(YC_TEST.apiKey);

    expect(await changeYCloudKey(owner, channelId, { apiKey: YC_TEST.newApiKey }, service.deps)).toMatchObject({ ok: true });
    expect(readYCloudSecrets(await row(channelId))).toEqual({ apiKey: YC_TEST.newApiKey, webhookSecret: YC_TEST.webhookSecret });
    expect((await db.select().from(auditLog)).map((entry) => entry.action)).toContain("channel.token_changed");
  });

  it("«Sincronizar plantillas» brings the account's templates from YCloud [YC-07]", async () => {
    const service = ycloud();
    const { channelId } = await connect({}, service);
    expect(await syncYCloudTemplatesNow(owner, channelId, service.deps)).toEqual({ total: 1, approved: 1 });
    expect(await db.select().from(whatsappTemplates)).toMatchObject([{ channelId, name: "recordatorio_cita", language: "es", category: "UTILITY", status: "APPROVED", variables: ["1", "2"] }]);
    expect(service.calls.find((call) => call.path === "/whatsapp/templates")?.query.get("filter.wabaId")).toBe(YC_TEST.wabaId);
  });

  it("the diagnostics test of the channel is YCloud's own check [AJU-11]", async () => {
    vi.stubEnv("APP_URL", PUBLIC_URL);
    const service = ycloud();
    const { channelId } = await connect({}, service);
    vi.stubEnv("YCLOUD_API_BASE_URL", service.deps.baseUrl);
    vi.stubGlobal("fetch", service.deps.fetchImpl);
    try {
      const result = await runConnectionTest(owner, { target: "channel", channelId });
      expect(result).toMatchObject({ ok: true, summary: expect.stringMatching(/YCloud acepta la clave/) });
      expect(result.checks.map((check) => check.text)).toEqual(expect.arrayContaining([expect.stringMatching(/^Clave de YCloud:/), expect.stringMatching(/^Saldo:/)]));
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("disconnecting [YC-10]", () => {
  it("deletes the webhook endpoint in YCloud and the key; the channel keeps its history, disabled, and comes back through the wizard", async () => {
    vi.stubEnv("APP_URL", PUBLIC_URL);
    const service = ycloud();
    const { channelId } = await connect({}, service);
    expect(await disconnectYCloudChannel(owner, channelId, service.deps)).toEqual({ warning: null });
    expect(service.account.endpoints.size).toBe(0);
    const channel = await row(channelId);
    expect(channel).toMatchObject({ status: "disabled", secretsEnc: null, connectionMode: "ycloud", phoneNumberId: "ycloud:34600111222" });
    expect(await pendingJobs(YCLOUD_HEALTH_CHECK_JOB)).toHaveLength(0);
    expect((await getChannel(owner, channelId)).hasSecrets).toBe(false);
    // «Activar» does not bring it back: its key is gone ([WA-28]).
    await expect(updateChannel(owner, channelId, { enabled: true })).rejects.toThrow(ConflictError);
    await expect(revalidateYCloudChannel(owner, channelId, service.deps)).rejects.toThrow(ConflictError);

    // The wizard reconnects the same channel; another number there is refused.
    await expect(connectYCloudChannel(owner, form({ channelId, phoneNumber: YC_TEST.otherPhoneNumber }), ycloud(ycloudAccount({}, { numbers: [phoneNumberResponse({ phoneNumber: YC_TEST.otherPhoneNumber })] })).deps)).rejects.toThrow(ConflictError);
    const again = await connectYCloudChannel(owner, form({ channelId }), service.deps);
    expect(again).toMatchObject({ status: "connected", channelId, receiving: true });
    expect(await db.select().from(channels)).toHaveLength(1);
    expect((await db.select().from(auditLog)).map((entry) => entry.action)).toEqual(expect.arrayContaining(["channel.disconnected", "channel.reconnected"]));
  });

  it("an endpoint YCloud cannot delete leaves a notice, and the key is deleted anyway", async () => {
    vi.stubEnv("APP_URL", PUBLIC_URL);
    const service = ycloud();
    const { channelId } = await connect({}, service);
    const failing = ycloud(ycloudAccount({ "DELETE /webhookEndpoints/:id": () => ycError(500, "INTERNAL_SERVER_ERROR") }));
    expect((await disconnectYCloudChannel(owner, channelId, failing.deps)).warning).toMatch(/Developers › Webhooks/);
    expect((await row(channelId)).secretsEnc).toBeNull();
  });

  it("deleting a channel without conversations also removes its endpoint in YCloud", async () => {
    vi.stubEnv("APP_URL", PUBLIC_URL);
    const service = ycloud();
    const { channelId } = await connect({}, service);
    vi.stubEnv("YCLOUD_API_BASE_URL", service.deps.baseUrl);
    vi.stubGlobal("fetch", service.deps.fetchImpl);
    try {
      await deleteChannel(owner, channelId);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(await db.select().from(channels)).toHaveLength(0);
    expect(service.account.endpoints.size).toBe(0);
  });
});
