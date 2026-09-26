// What every tab of the editor loads on the server: who is looking and the agent, checked on each request ([SEG-04]).
// The layout is not the security boundary: each page calls this again (deduplicated per request).
import "server-only";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getAgent, type Agent } from "@/data/agents";
import { can, PERMISSIONS, type Actor, type Role } from "@/lib/permissions";
import { NotFoundError } from "@/server/errors";
import { requirePageActor, type SessionActor } from "@/server/session";
import { agentPath } from "../../_lib/labels";

/** The agent, or the «not found» page for an unknown or malformed id. */
export const loadEditorAgent = cache(async (actor: Actor, agentId: string): Promise<Agent> => {
  try {
    return await getAgent(actor, agentId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
});

export type EditorPage =
  | { allowed: true; actor: SessionActor; agent: Agent; /** Owner and admin; the rest see the tab read-only. */ canManage: boolean }
  | { allowed: false; role: Role };

/** Session (or /login coming back to this tab), permission to see agents, and the agent. */
export async function loadEditorPage(params: Promise<{ id: string }>, segment = ""): Promise<EditorPage> {
  const { id } = await params;
  const actor = await requirePageActor({ next: agentPath(encodeURIComponent(id), segment) });
  if (!can(actor, PERMISSIONS.agents.view)) return { allowed: false, role: actor.role };
  const agent = await loadEditorAgent(actor, id);
  return { allowed: true, actor, agent, canManage: can(actor, PERMISSIONS.agents.manage) };
}
