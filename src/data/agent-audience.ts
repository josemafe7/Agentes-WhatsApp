// Who an agent or a knowledge base is for ([INT-01], [INT-03], [INT-04], [INT-15], docs/decisions/0027): the checks
// the data layer shares. Something internal (audience = team) asks for its own permission on top of the area's, and
// an internal agent never answers customers.
import "server-only";
import { eq } from "drizzle-orm";
import type { Executor } from "@/db";
import { agents } from "@/db/schema";
import type { Audience } from "@/lib/enums";
import { can, PERMISSIONS, type Action, type Actor } from "@/lib/permissions";
import { NotFoundError, ValidationError } from "@/server/errors";

export const AGENT_NOT_FOUND = "No se ha encontrado el agente.";
export const KNOWLEDGE_BASE_NOT_FOUND = "No se ha encontrado la base de conocimiento.";
export const INTERNAL_AGENT_NOT_FOR_CUSTOMERS = "Ese agente es interno: responde al equipo, no a los clientes.";
export const INTERNAL_BASE_NOT_FOR_CUSTOMERS = "Una base interna solo la pueden usar los agentes internos.";

/** Whether `actor` sees internal agents at all (Agentes lists them, the editor opens them). */
export const seesInternalAgents = (actor: Actor) => can(actor, PERMISSIONS.internal.agents);
/** Whether `actor` sees internal knowledge bases at all. */
export const seesInternalKnowledge = (actor: Actor) => can(actor, PERMISSIONS.internal.knowledge);

/**
 * An internal agent does not exist for who cannot manage internal agents ([INT-15]): «not found», so nothing tells a
 * supervisor or a viewer that there is one. Call it after the area's own permission check.
 */
export function assertAgentAudience(actor: Actor, agent: { audience: Audience }): void {
  if (agent.audience === "team" && !seesInternalAgents(actor)) throw new NotFoundError(AGENT_NOT_FOUND);
}

/** The same for an internal knowledge base. */
export function assertKnowledgeAudience(actor: Actor, base: { audience: Audience }): void {
  if (base.audience === "team" && !seesInternalKnowledge(actor)) throw new NotFoundError(KNOWLEDGE_BASE_NOT_FOUND);
}

/** The permission an agent of that audience asks for: «Agentes internos» for an internal one, the area's otherwise. */
export function agentAction(audience: Audience, customers: Action): Action {
  return audience === "team" ? PERMISSIONS.internal.agents : customers;
}

/**
 * The agent that will answer customers on a channel or in a conversation exists and is not an internal one
 * ([INT-03]). `field` is the form field the message belongs to.
 */
export async function assertAnswersCustomers(executor: Executor, agentId: string | null | undefined, field = "activeAgentId"): Promise<void> {
  if (!agentId) return;
  const [agent] = await executor.select({ audience: agents.audience }).from(agents).where(eq(agents.id, agentId));
  if (!agent) throw new ValidationError(undefined, { [field]: ["Ese agente no existe."] });
  if (agent.audience !== "customers") throw new ValidationError(undefined, { [field]: [INTERNAL_AGENT_NOT_FOR_CUSTOMERS] });
}
