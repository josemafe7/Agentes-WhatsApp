"use server";
// Server Actions of Herramientas HTTP ([HER-11]–[HER-14]). Thin: session and permission here, then src/data, which
// checks the permission again and validates every field with Zod ([SEG-04], [SEG-05]). Nothing they return carries a
// secret: saving answers with the id, and «Probar» with the answer already stripped of the secret headers ([HER-12]).
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createCustomTool, deleteCustomTool, testCustomTool, updateCustomTool, type CustomToolTestResult } from "@/data/custom-tools";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { PERMISSIONS } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";

const NOT_FOUND = "No se ha encontrado la herramienta.";

/** The list and each tool's page, and the agents' Herramientas tab, which lists them too. */
function revalidateTools(): void {
  revalidatePath("/agentes/herramientas", "layout");
  revalidatePath("/agentes/[id]", "layout");
}

const saveSchema = z.object({ toolId: idSchema.optional(), tool: z.unknown() });

/** «Guardar»: creates the tool (without `toolId`) or saves its form. Answers with its id, to open its page. */
export async function saveCustomToolAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requirePermission(PERMISSIONS.agents.customTools);
    const parsed = saveSchema.safeParse(input);
    if (!parsed.success) return fail(NOT_FOUND);
    const { toolId, tool } = parsed.data;
    if (toolId) {
      await updateCustomTool(actor, toolId, tool);
      revalidateTools();
      return ok({ id: toolId }, "Herramienta guardada.");
    }
    const created = await createCustomTool(actor, tool);
    revalidateTools();
    return ok({ id: created.id }, "Herramienta creada.");
  } catch (error) {
    return toActionFailure(error);
  }
}

const deleteSchema = z.object({ toolId: idSchema, confirmInUse: z.boolean().optional() });

/** «Borrar»: `confirmInUse` once the person has seen which agents use it ([AGE-08]). */
export async function deleteCustomToolAction(input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.agents.customTools);
    const parsed = deleteSchema.safeParse(input);
    if (!parsed.success) return fail(NOT_FOUND);
    await deleteCustomTool(actor, parsed.data.toolId, { confirmInUse: parsed.data.confirmInUse });
    revalidateTools();
    return ok(undefined, "Herramienta borrada.");
  } catch (error) {
    return toActionFailure(error);
  }
}

const testSchema = z.object({ toolId: idSchema, args: z.record(z.string(), z.unknown()) });

/** «Probar» with sample values: runs on the server; status, time and the answer cut short, never the secrets. */
export async function testCustomToolAction(input: unknown): Promise<ActionResult<CustomToolTestResult>> {
  try {
    const actor = await requirePermission(PERMISSIONS.agents.customTools);
    const parsed = testSchema.safeParse(input);
    if (!parsed.success) return fail(NOT_FOUND);
    return ok(await testCustomTool(actor, parsed.data.toolId, parsed.data.args));
  } catch (error) {
    return toActionFailure(error);
  }
}
