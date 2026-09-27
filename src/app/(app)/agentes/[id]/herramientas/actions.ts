"use server";
// Server Action of the custom HTTP tools section of the agent's Herramientas tab ([AGE-08]): owner and admin switch a
// tool on or off for this agent. Session and permission here, then src/data checks again ([SEG-04]).
import { revalidatePath } from "next/cache";
import { agentCustomToolSchema, setAgentCustomTool } from "@/data/custom-tools";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { PERMISSIONS } from "@/lib/permissions";
import { toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";

/** «Usar» of one tool; runAgent offers it from the next message, in «Probar agente» too. */
export async function setAgentCustomToolAction(input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.agents.customTools);
    const parsed = agentCustomToolSchema.safeParse(input);
    if (!parsed.success) return fail("No se ha encontrado la herramienta.");
    const { toolName } = await setAgentCustomTool(actor, parsed.data);
    revalidatePath("/agentes/[id]", "layout");
    revalidatePath("/agentes/herramientas", "layout");
    return ok(undefined, parsed.data.attached ? `Este agente ya puede usar «${toolName}».` : `Este agente ya no usa «${toolName}».`);
  } catch (error) {
    return toActionFailure(error);
  }
}
