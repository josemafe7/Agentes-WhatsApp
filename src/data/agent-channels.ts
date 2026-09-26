// The Canales tab of an agent ([AGE-10], [AGE-11], [CAN-03]): each channel with «Activo aquí». A channel has at most
// one active agent; an agent may be active in several channels. Seeing the list is «Canales: ver»; switching the
// active agent is «Canales: … agente activo e IA del canal» (owner and admin).
import "server-only";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { agents, channels } from "@/db/schema";
import type { ChannelStatus, ChannelType } from "@/lib/enums";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { ConflictError, NotFoundError, parseInput } from "@/server/errors";
import { writeAudit } from "./audit";
import { assertCan } from "./guard";

export type AgentChannelItem = {
  id: string;
  name: string;
  type: ChannelType;
  status: ChannelStatus;
  isDemo: boolean;
  /** This agent is the active one here. */
  activeHere: boolean;
  /** Name of the agent active now (this one or another), for «Sustituirá a …». */
  activeAgentName: string | null;
};

/** Every channel and which agent answers in it, seen from one agent. */
export async function listAgentChannels(actor: Actor, agentId: string): Promise<AgentChannelItem[]> {
  assertCan(actor, PERMISSIONS.agents.view);
  assertCan(actor, PERMISSIONS.channels.view);
  const id = idSchema.safeParse(agentId);
  if (!id.success) throw new NotFoundError("No se ha encontrado el agente.");
  const rows = await db
    .select({
      id: channels.id,
      name: channels.name,
      type: channels.type,
      status: channels.status,
      isDemo: channels.isDemo,
      activeAgentId: channels.activeAgentId,
      activeAgentName: agents.name,
    })
    .from(channels)
    .leftJoin(agents, eq(agents.id, channels.activeAgentId))
    .orderBy(asc(channels.name));
  return rows.map(({ activeAgentId, ...row }) => ({ ...row, activeHere: activeAgentId === id.data }));
}

const activeInputSchema = z
  .object({
    agentId: idSchema,
    channelId: idSchema,
    active: z.boolean(),
    /** The person confirmed «Sustituirá a …» ([AGE-10]). */
    confirmReplace: z.boolean().optional(),
  })
  .strict();

/**
 * «Activo aquí» on or off. Replacing another agent needs `confirmReplace` (otherwise ConflictError saying who would be
 * replaced, and nothing changes). Affects new messages only ([CAN-05]).
 */
export async function setAgentChannelActive(actor: Actor, input: unknown): Promise<{ replacedAgentName: string | null }> {
  const data = parseInput(activeInputSchema, input);
  assertCan(actor, PERMISSIONS.channels.manage, { channelId: data.channelId });
  return db.transaction(async (tx) => {
    const [agent] = await tx.select({ id: agents.id, name: agents.name }).from(agents).where(eq(agents.id, data.agentId));
    if (!agent) throw new NotFoundError("No se ha encontrado el agente.");
    const [channel] = await tx
      .select({ id: channels.id, name: channels.name, activeAgentId: channels.activeAgentId, activeAgentName: agents.name })
      .from(channels)
      .leftJoin(agents, eq(agents.id, channels.activeAgentId))
      .where(eq(channels.id, data.channelId));
    if (!channel) throw new NotFoundError("No se ha encontrado el canal.");

    const replaced = data.active && channel.activeAgentId && channel.activeAgentId !== agent.id ? channel.activeAgentName : null;
    if (replaced && !data.confirmReplace) throw new ConflictError(`En «${channel.name}» responde ahora «${replaced}». Si continúas, lo sustituirá.`);
    const next = data.active ? agent.id : channel.activeAgentId === agent.id ? null : channel.activeAgentId;
    if (next !== channel.activeAgentId) {
      await tx.update(channels).set({ activeAgentId: next, updatedAt: new Date() }).where(eq(channels.id, channel.id));
      await writeAudit(
        {
          actor,
          action: "channel.agent_changed",
          targetType: "channel",
          targetId: channel.id,
          metadata: { agentId: next, previousAgentId: channel.activeAgentId },
        },
        tx,
      );
    }
    return { replacedAgentName: replaced };
  });
}
