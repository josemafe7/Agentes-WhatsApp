import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { agentContextFiles, agents, agentVersions, auditLog, channels, conversations, messages } from "@/db/schema";
import type { Role } from "@/lib/enums";
import type { Actor } from "@/lib/permissions";
import { AuthError, ConflictError } from "@/server/errors";
import { actorFor, createBusiness, createChannel, createUser } from "@/test/factories";
import { listAgentChannels, setAgentChannelActive } from "./agent-channels";
import { createAgent } from "./agents";

let owner: Actor;

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

async function activeAgentOf(channelId: string) {
  const [row] = await db.select({ activeAgentId: channels.activeAgentId }).from(channels).where(eq(channels.id, channelId));
  return row.activeAgentId;
}

beforeAll(async () => {
  owner = (await createUser("owner")).actor;
});

/** Each test starts without agents or channels (children first: nothing relies on cascades). */
async function clearAgentsAndChannels() {
  await db.delete(messages);
  await db.delete(conversations);
  await db.delete(channels);
  await db.delete(agentContextFiles);
  await db.delete(agentVersions);
  await db.delete(agents);
  await db.delete(auditLog);
}

beforeEach(async () => {
  await clearAgentsAndChannels();
  await createBusiness();
});

describe("«Activo aquí» [AGE-10] [AGE-11] [CAN-03]", () => {
  it("an agent can be active in several channels at once", async () => {
    const agent = await createAgent(owner, { name: "Recepción" });
    const web = await createChannel({ name: "Web" });
    const whatsapp = await createChannel({ name: "WhatsApp", type: "whatsapp" });
    await setAgentChannelActive(owner, { agentId: agent.id, channelId: web.id, active: true });
    await setAgentChannelActive(owner, { agentId: agent.id, channelId: whatsapp.id, active: true });
    expect(await activeAgentOf(web.id)).toBe(agent.id);
    expect(await activeAgentOf(whatsapp.id)).toBe(agent.id);
    const list = await listAgentChannels(owner, agent.id);
    expect(list.map((channel) => [channel.name, channel.activeHere, channel.activeAgentName])).toEqual([
      ["Web", true, "Recepción"],
      ["WhatsApp", true, "Recepción"],
    ]);
  });

  it("replacing another agent needs confirmation and says who is replaced; without it nothing changes", async () => {
    const first = await createAgent(owner, { name: "Recepción" });
    const second = await createAgent(owner, { name: "Ventas" });
    const web = await createChannel({ name: "Web", activeAgentId: first.id });
    expect((await listAgentChannels(owner, second.id))[0]).toMatchObject({ activeHere: false, activeAgentName: "Recepción" });

    const refused = await errorOf(setAgentChannelActive(owner, { agentId: second.id, channelId: web.id, active: true }));
    expect(refused).toBeInstanceOf(ConflictError);
    expect((refused as ConflictError).userMessage).toMatch(/Recepción/);
    expect(await activeAgentOf(web.id)).toBe(first.id);

    const done = await setAgentChannelActive(owner, { agentId: second.id, channelId: web.id, active: true, confirmReplace: true });
    expect(done).toEqual({ replacedAgentName: "Recepción" });
    expect(await activeAgentOf(web.id)).toBe(second.id);
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, "channel.agent_changed"));
    expect(entry).toMatchObject({ targetId: web.id, metadata: { agentId: second.id, previousAgentId: first.id } });
  });

  it("switching it off leaves the channel without agent, and never touches another agent's channel", async () => {
    const first = await createAgent(owner, { name: "Recepción" });
    const second = await createAgent(owner, { name: "Ventas" });
    const web = await createChannel({ name: "Web", activeAgentId: first.id });
    await setAgentChannelActive(owner, { agentId: second.id, channelId: web.id, active: false });
    expect(await activeAgentOf(web.id)).toBe(first.id);
    await setAgentChannelActive(owner, { agentId: first.id, channelId: web.id, active: false });
    expect(await activeAgentOf(web.id)).toBeNull();
  });

  it.each(["supervisor", "agent", "viewer"] as Role[])("%s cannot change the active agent of a channel", async (role) => {
    const agent = await createAgent(owner, { name: "Recepción" });
    const web = await createChannel({ name: "Web" });
    expect(await errorOf(setAgentChannelActive(actorFor(role), { agentId: agent.id, channelId: web.id, active: true }))).toBeInstanceOf(AuthError);
    expect(await activeAgentOf(web.id)).toBeNull();
  });

  it("supervisors do not see the channels list (they only see channel names in the inbox) [PER-04]", async () => {
    const agent = await createAgent(owner, { name: "Recepción" });
    expect(await errorOf(listAgentChannels(actorFor("supervisor"), agent.id))).toBeInstanceOf(AuthError);
    expect(await listAgentChannels(actorFor("viewer"), agent.id)).toEqual([]);
  });
});
