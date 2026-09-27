import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { agents, auditLog, channelMembers, channels, contactIdentities, contacts, conversations, jobs, userRoles } from "@/db/schema";
import { HEALTH_CHECK_JOB } from "@/server/channels/whatsapp/schedule";
import { encryptChannelSecrets } from "@/server/channels/secrets";
import { AuthError, ConflictError, ValidationError } from "@/server/errors";
import { createAgentRow, createBusiness, createChannel, createContactWithIdentity, createConversation, createUser, type TestUser } from "@/test/factories";
import { setAgentChannelActive } from "./agent-channels";
import {
  createWebchatChannel,
  deleteChannel,
  getChannel,
  listChannels,
  listInboxChannels,
  setActiveAgent,
  setChannelMembers,
  updateChannel,
  updateWebchatConfig,
} from "./channels";

let users: Record<"owner" | "admin" | "supervisor" | "agent" | "viewer", TestUser>;

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}
const forbidden = async (promise: Promise<unknown>) => expect(await errorOf(promise)).toBeInstanceOf(AuthError);
const channelRow = async (id: string) => (await db.select().from(channels).where(eq(channels.id, id)))[0];

beforeAll(async () => {
  await createBusiness();
  await db.delete(userRoles);
  users = {
    owner: await createUser("owner"),
    admin: await createUser("admin"),
    supervisor: await createUser("supervisor"),
    agent: await createUser("agent"),
    viewer: await createUser("viewer"),
  };
});

beforeEach(async () => {
  await db.delete(conversations);
  await db.delete(contactIdentities);
  await db.delete(contacts);
  await db.delete(channelMembers);
  await db.update(channels).set({ activeAgentId: null });
  await db.delete(channels);
  await db.delete(agents);
  await db.delete(auditLog);
});

describe("seeing channels [CAN-01] [PER-03] [PER-04]", () => {
  it("owner, admin and Solo lectura see the list with state, agent and AI; supervisor and agent do not", async () => {
    const agent = await createAgentRow({ name: "Recepción" });
    await createChannel({ name: "Web", activeAgentId: agent.id, lastInboundAt: new Date("2026-09-30T08:00:00Z") });
    await createChannel({ name: "WhatsApp demo", type: "whatsapp", isDemo: true, aiEnabled: false });
    for (const role of ["owner", "admin", "viewer"] as const) {
      const list = await listChannels(users[role].actor);
      expect(list.map((channel) => [channel.name, channel.activeAgent?.name ?? null, channel.aiEnabled, channel.isDemo])).toEqual([
        ["Web", "Recepción", true, false],
        ["WhatsApp demo", null, false, true],
      ]);
    }
    await forbidden(listChannels(users.supervisor.actor));
    await forbidden(listChannels(users.agent.actor));
  });

  it("never returns credentials, only whether there are any [CAN-17] [SEG-02]", async () => {
    const channel = await createChannel({ name: "WA", type: "whatsapp", secretsEnc: encryptChannelSecrets({ accessToken: "EAAG-secreto" }) });
    const detail = await getChannel(users.viewer.actor, channel.id);
    expect(detail.hasSecrets).toBe(true);
    expect(JSON.stringify(detail)).not.toContain("secreto");
    expect(JSON.stringify(detail)).not.toContain(channel.secretsEnc ?? "none");
  });

  it("the inbox filter lists channel names for everyone who sees the inbox, agents only theirs", async () => {
    const web = await createChannel({ name: "Web" });
    await createChannel({ name: "Otra" });
    expect((await listInboxChannels(users.supervisor.actor)).map((channel) => channel.name)).toEqual(["Otra", "Web"]);
    const limited = { ...users.agent.actor, channelIds: [web.id] };
    expect((await listInboxChannels(limited)).map((channel) => channel.name)).toEqual(["Web"]);
  });
});

describe("web chat channels [WEB-01] [WEB-02] [WEB-07] [WEB-10]", () => {
  it("owner and admin create one with its settings; the rest cannot", async () => {
    const agent = await createAgentRow();
    const { id } = await createWebchatChannel(users.admin.actor, {
      name: "Chat de la web",
      activeAgentId: agent.id,
      config: { color: "#112233", welcomeMessage: "¡Hola!", position: "left", allowedDomains: ["www.peluqueria.es"], voiceEnabled: true },
    });
    const detail = await getChannel(users.owner.actor, id);
    expect(detail).toMatchObject({ type: "webchat", status: "connected", replyMode: "auto", activeAgent: { id: agent.id }, capabilities: { audio: true, images: false } });
    expect(detail.webchat).toMatchObject({ color: "#112233", position: "left", allowedDomains: ["www.peluqueria.es"], voiceEnabled: true, imagesEnabled: false });
    for (const role of ["supervisor", "agent", "viewer"] as const) await forbidden(createWebchatChannel(users[role].actor, { name: "X" }));
  });

  it("rejects invalid settings", async () => {
    expect(await errorOf(createWebchatChannel(users.owner.actor, { name: "X", config: { allowedDomains: ["https://malo.es/ruta"] } }))).toBeInstanceOf(ValidationError);
    expect(await errorOf(createWebchatChannel(users.owner.actor, { name: "X", config: { color: "rojo" } }))).toBeInstanceOf(ValidationError);
    expect(await errorOf(createWebchatChannel(users.owner.actor, { name: "X", activeAgentId: crypto.randomUUID() }))).toBeInstanceOf(ValidationError);
  });

  it("updates the look and the optional voice and images", async () => {
    const { id } = await createWebchatChannel(users.owner.actor, { name: "Chat" });
    await updateWebchatConfig(users.owner.actor, id, { imagesEnabled: true, welcomeMessage: "Bienvenida" });
    expect((await getChannel(users.owner.actor, id)).capabilities).toMatchObject({ images: true, audio: false });
    await forbidden(updateWebchatConfig(users.viewer.actor, id, {}));
  });

  it("never takes the logo from the request: only an uploaded logo changes it [MED-08] [SEG-05]", async () => {
    const privateKey = "media/2026/09/1c1c1c1c-aaaa-4bbb-8ccc-123456789abc.png";
    expect(await errorOf(createWebchatChannel(users.owner.actor, { name: "X", config: { logoFileKey: privateKey } }))).toBeInstanceOf(ValidationError);
    const { id } = await createWebchatChannel(users.owner.actor, { name: "Chat" });
    expect(await errorOf(updateWebchatConfig(users.owner.actor, id, { logoFileKey: privateKey }))).toBeInstanceOf(ValidationError);
    const uploaded = "webchat-logos/2026/09/2d2d2d2d-aaaa-4bbb-8ccc-123456789abc.png";
    await db.update(channels).set({ config: { logoFileKey: uploaded } }).where(eq(channels.id, id));
    // Saving the look (with or without the current key) keeps the uploaded logo.
    await updateWebchatConfig(users.owner.actor, id, { welcomeMessage: "Hola" });
    expect((await getChannel(users.owner.actor, id)).webchat?.logoFileKey).toBe(uploaded);
    await updateWebchatConfig(users.owner.actor, id, { welcomeMessage: "Hola", logoFileKey: uploaded });
    expect((await getChannel(users.owner.actor, id)).webchat?.logoFileKey).toBe(uploaded);
  });
});

describe("common settings [CAN-04] [CAN-06] [CAN-07] [CAN-08] [CAN-16]", () => {
  it("AI switch, test mode and list, reply mode, AI notice and off-hours behaviour", async () => {
    const channel = await createChannel({ name: "Web" });
    await updateChannel(users.admin.actor, channel.id, {
      aiEnabled: false,
      testMode: true,
      testAllowlist: ["+34 600 111 222", "+34 600 111 222", "ana@example.com"],
      replyMode: "draft",
      disclosureMessage: "Soy una IA.",
      offHoursBehavior: "no_reply",
    });
    expect(await channelRow(channel.id)).toMatchObject({
      aiEnabled: false,
      testMode: true,
      testAllowlist: ["+34 600 111 222", "ana@example.com"],
      replyMode: "draft",
      disclosureMessage: "Soy una IA.",
      offHoursBehavior: "no_reply",
    });
    for (const role of ["supervisor", "agent", "viewer"] as const) await forbidden(updateChannel(users[role].actor, channel.id, { aiEnabled: true }));
  });

  it("disabling keeps the history; enabling a web chat puts it back to «conectado»", async () => {
    const channel = await createChannel({ name: "Web" });
    await updateChannel(users.owner.actor, channel.id, { enabled: false });
    expect((await channelRow(channel.id)).status).toBe("disabled");
    await updateChannel(users.owner.actor, channel.id, { enabled: true });
    expect((await channelRow(channel.id)).status).toBe("connected");
  });

  it("a disconnected WhatsApp number goes back through its wizard; one with credentials returns to «conectando» and is checked at once [WA-28] [CAN-15] [CAN-16]", async () => {
    const disconnected = await createChannel({ name: "WA desconectado", type: "whatsapp", status: "disabled" });
    expect(await errorOf(updateChannel(users.owner.actor, disconnected.id, { enabled: true }))).toBeInstanceOf(ConflictError);
    expect((await channelRow(disconnected.id)).status).toBe("disabled");

    await db.delete(jobs);
    const paused = await createChannel({ name: "WA pausado", type: "whatsapp", status: "disabled", secretsEnc: encryptChannelSecrets({ access_token: "EAAG-secreto" }) });
    await updateChannel(users.owner.actor, paused.id, { enabled: true });
    expect((await channelRow(paused.id)).status).toBe("connecting");
    const checks = await db.select().from(jobs).where(eq(jobs.type, HEALTH_CHECK_JOB));
    expect(checks.map((job) => job.payload)).toEqual([{ channelId: paused.id }]);
  });

  it("only a channel without conversations can be deleted", async () => {
    const empty = await createChannel({ name: "Vacío" });
    const used = await createChannel({ name: "Usado" });
    await createConversation(used.id, (await createContactWithIdentity("webchat")).contact.id);
    await forbidden(deleteChannel(users.viewer.actor, empty.id));
    await deleteChannel(users.owner.actor, empty.id);
    expect(await channelRow(empty.id)).toBeUndefined();
    expect(await errorOf(deleteChannel(users.owner.actor, used.id))).toBeInstanceOf(ConflictError);
    expect(await channelRow(used.id)).toBeDefined();
  });
});

describe("active agent [CAN-03] [CAN-04] [AGE-10]", () => {
  it("at most one per channel; replacing another asks first and returns who it was", async () => {
    const first = await createAgentRow({ name: "Recepción" });
    const second = await createAgentRow({ name: "Ventas" });
    const channel = await createChannel({ name: "Web" });
    expect(await setActiveAgent(users.owner.actor, { channelId: channel.id, agentId: first.id })).toEqual({ status: "changed", previousAgent: null });
    expect(await setActiveAgent(users.owner.actor, { channelId: channel.id, agentId: second.id })).toEqual({
      status: "needs_confirmation",
      previousAgent: { id: first.id, name: "Recepción" },
    });
    expect((await channelRow(channel.id)).activeAgentId).toBe(first.id);
    expect(await setActiveAgent(users.admin.actor, { channelId: channel.id, agentId: second.id, confirmReplace: true })).toEqual({
      status: "changed",
      previousAgent: { id: first.id, name: "Recepción" },
    });
    expect((await channelRow(channel.id)).activeAgentId).toBe(second.id);
    // No agent: only people answer.
    await setActiveAgent(users.owner.actor, { channelId: channel.id, agentId: null });
    expect((await channelRow(channel.id)).activeAgentId).toBeNull();
    const audit = await db.select().from(auditLog).where(eq(auditLog.action, "channel.agent_changed"));
    expect(audit).toHaveLength(3);
  });

  it("the agent's Canales tab writes the same way", async () => {
    const agent = await createAgentRow({ name: "Recepción" });
    const channel = await createChannel({ name: "Web" });
    await setAgentChannelActive(users.owner.actor, { agentId: agent.id, channelId: channel.id, active: true });
    expect((await channelRow(channel.id)).activeAgentId).toBe(agent.id);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "channel.agent_changed"))).toHaveLength(1);
  });

  it("only owner and admin change it", async () => {
    const agent = await createAgentRow();
    const channel = await createChannel({ name: "Web" });
    for (const role of ["supervisor", "agent", "viewer"] as const) await forbidden(setActiveAgent(users[role].actor, { channelId: channel.id, agentId: agent.id }));
    expect((await channelRow(channel.id)).activeAgentId).toBeNull();
  });
});

describe("channel members [USU-17]", () => {
  it("only people with the Agent role are limited to a channel", async () => {
    const channel = await createChannel({ name: "Web" });
    await setChannelMembers(users.owner.actor, { channelId: channel.id, userIds: [users.agent.userId] });
    expect((await getChannel(users.owner.actor, channel.id)).memberIds).toEqual([users.agent.userId]);
    expect(await errorOf(setChannelMembers(users.owner.actor, { channelId: channel.id, userIds: [users.supervisor.userId] }))).toBeInstanceOf(ValidationError);
    await forbidden(setChannelMembers(users.viewer.actor, { channelId: channel.id, userIds: [] }));
    await setChannelMembers(users.admin.actor, { channelId: channel.id, userIds: [] });
    expect((await getChannel(users.owner.actor, channel.id)).memberIds).toEqual([]);
  });
});

describe("an agent left without any channel sees them all: the admin is told [PER-02] [USU-17]", () => {
  it("taking an agent off their only channel warns that they will now see every channel; one who keeps another is not named", async () => {
    const web = await createChannel({ name: "Web" });
    const other = await createChannel({ name: "Otra" });
    const ana = await createUser("agent", { name: "Ana Recepción", channelIds: [web.id] });
    await createUser("agent", { name: "Luis Tardes", channelIds: [web.id, other.id] });
    const result = await setChannelMembers(users.owner.actor, { channelId: web.id, userIds: [] });
    expect(result.agentsSeeingAll).toEqual([{ id: ana.userId, name: "Ana Recepción" }]);
    expect(result.warning).toBe(
      "«Ana Recepción» ya no tiene ningún canal asignado, así que desde ahora verá todos los canales. Si no es lo que quieres, asígnale sus canales en Ajustes › Usuarios.",
    );
  });

  it("several at once are named together; when nobody is left without channels there is no warning", async () => {
    const web = await createChannel({ name: "Web" });
    const ana = await createUser("agent", { name: "Ana", channelIds: [web.id] });
    const bea = await createUser("agent", { name: "Bea", channelIds: [web.id] });
    const carla = await createUser("agent", { name: "Carla", channelIds: [web.id] });
    const all = await setChannelMembers(users.owner.actor, { channelId: web.id, userIds: [] });
    expect(all.agentsSeeingAll.map((agent) => agent.name).sort()).toEqual(["Ana", "Bea", "Carla"]);
    expect(all.warning).toMatch(/^«(Ana|Bea|Carla)», «(Ana|Bea|Carla)» y «(Ana|Bea|Carla)» ya no tienen ningún canal asignado, así que desde ahora verán todos los canales\./);
    expect(all.warning).toContain("asígnales sus canales en Ajustes › Usuarios.");
    // Giving the channel back, or adding someone, leaves nobody without channels.
    expect(await setChannelMembers(users.owner.actor, { channelId: web.id, userIds: [ana.userId, bea.userId, carla.userId] })).toEqual({ agentsSeeingAll: [], warning: null });
    const two = await setChannelMembers(users.owner.actor, { channelId: web.id, userIds: [ana.userId] });
    expect(two.warning).toMatch(/^«(Bea|Carla)» y «(Bea|Carla)» ya no tienen/);
  });

  it("deleting an agent's only channel warns the same way; a channel whose agents keep others, or has none, does not", async () => {
    const web = await createChannel({ name: "Web" });
    const other = await createChannel({ name: "Otra" });
    const empty = await createChannel({ name: "Sin personas" });
    const ana = await createUser("agent", { name: "Ana", channelIds: [web.id] });
    await createUser("agent", { name: "Luis", channelIds: [other.id, empty.id] });
    expect(await deleteChannel(users.owner.actor, empty.id)).toEqual({ agentsSeeingAll: [], warning: null });
    const deleted = await deleteChannel(users.owner.actor, web.id);
    expect(deleted.agentsSeeingAll).toEqual([{ id: ana.userId, name: "Ana" }]);
    expect(deleted.warning).toBe("«Ana» ya no tiene ningún canal asignado, así que desde ahora verá todos los canales. Si no es lo que quieres, asígnale sus canales en Ajustes › Usuarios.");
  });
});
