// Step 6 of the setup wizard, «Chat web de prueba» ([ASI-09], [ASI-11]): creates a web chat whose active agent is the one
// of step 5 (if it was not skipped), with the AI on, so the owner can try it at once in /widget-demo. The channel's id
// stays in the setup progress (app_kv): coming back to this step shows that chat instead of creating another one. Only
// the owner continues the wizard; the channel is created by src/data/channels.ts, which checks and validates again.
import "server-only";
import { z } from "zod";
import { db } from "@/db";
import type { Actor } from "@/lib/permissions";
import { NotFoundError, parseInput } from "@/server/errors";
import { getKv, setKv } from "@/server/kv";
import { createWebchatChannel, createWebchatSchema, getChannel } from "./channels";
import { assertSetupOwner, completeStep, openStep, SETUP_STEP } from "./setup";
import { getSetupFirstAgent } from "./setup-agent";

/** app_kv key of the web chat this step created. */
export const SETUP_WEBCHAT_KEY = "setup.webchat_channel";
export const DEFAULT_SETUP_WEBCHAT_NAME = "Chat de la web";

type WebchatProgress = { channelId: string };

export type SetupWebchatChannel = { id: string; name: string; activeAgentName: string | null };

export type WebchatStepData = {
  /** The agent step 5 created; null when that step was skipped or the agent was deleted. */
  agent: { id: string; name: string } | null;
  /** The web chat this step already created, if it still exists. */
  channel: SetupWebchatChannel | null;
};

async function createdChannel(actor: Actor): Promise<SetupWebchatChannel | null> {
  const saved = await getKv<Partial<WebchatProgress>>(SETUP_WEBCHAT_KEY);
  if (!saved?.channelId) return null;
  try {
    const channel = await getChannel(actor, saved.channelId);
    return { id: channel.id, name: channel.name, activeAgentName: channel.activeAgent?.name ?? null };
  } catch (error) {
    // Deleted from Canales meanwhile: the step offers to create it again.
    if (error instanceof NotFoundError) return null;
    throw error;
  }
}

/** Step 6. Owner only ([ASI-11]). */
export async function getSetupWebchatStepData(actor: Actor): Promise<WebchatStepData> {
  assertSetupOwner(actor);
  const [agent, channel] = await Promise.all([getSetupFirstAgent(actor), createdChannel(actor)]);
  return { agent, channel };
}

export const webchatStepSchema = z.object({ name: createWebchatSchema.shape.name }).strict();

/**
 * «Crear el chat web»: a web chat with the agent of step 5 active and the AI on (automatic replies, the chat only
 * works inside the app until the business adds its domains, [WEB-10]). Done twice, it keeps the first one.
 */
export async function createSetupWebchat(actor: Actor, input: unknown): Promise<{ channelId: string; created: boolean }> {
  assertSetupOwner(actor);
  const { name } = parseInput(webchatStepSchema, input);
  await openStep(db, SETUP_STEP.webchat);
  const existing = await createdChannel(actor);
  let channelId: string;
  if (existing) {
    channelId = existing.id;
  } else {
    const agent = await getSetupFirstAgent(actor);
    ({ id: channelId } = await createWebchatChannel(actor, { name, activeAgentId: agent?.id ?? null, aiEnabled: true }));
    await setKv(SETUP_WEBCHAT_KEY, { channelId } satisfies WebchatProgress);
  }
  await completeStep(actor, SETUP_STEP.webchat, existing ? "setup.webchat_kept" : "setup.webchat_created");
  return { channelId, created: !existing };
}
