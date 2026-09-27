"use server";
// Server Actions of Ajustes › Diagnóstico ([AJU-11]): owner and admin retry a failed job or cancel one that is
// waiting to retry after an error, and run the «Pruebas de conexión». The permission is checked again in src/data
// ([SEG-04]).
import { revalidatePath } from "next/cache";
import { cancelJob, retryJob } from "@/data/diagnostics";
import { runConnectionTest, type ConnectionTestResult } from "@/data/diagnostics-connections";
import { ok, type ActionResult } from "@/lib/action-result";
import { toActionFailure } from "@/server/errors";
import { requireActor } from "@/server/session";

const DIAGNOSTICS_PATH = "/ajustes/diagnostico";

export async function retryJobAction(input: { jobId: string }): Promise<ActionResult> {
  try {
    await retryJob(await requireActor(), input);
    revalidatePath(DIAGNOSTICS_PATH);
    return ok(undefined, "El trabajo se volverá a intentar ahora.");
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function cancelJobAction(input: { jobId: string }): Promise<ActionResult> {
  try {
    await cancelJob(await requireActor(), input);
    revalidatePath(DIAGNOSTICS_PATH);
    return ok(undefined, "Trabajo cancelado.");
  } catch (error) {
    return toActionFailure(error);
  }
}

/**
 * One «Prueba de conexión»: OpenRouter's key, the system mail or a channel. The result says in Spanish how it went; a
 * channel's lights and the log of system emails change, so their pages are refreshed.
 */
export async function runConnectionTestAction(input: unknown): Promise<ActionResult<ConnectionTestResult>> {
  try {
    const result = await runConnectionTest(await requireActor(), input);
    revalidatePath(DIAGNOSTICS_PATH);
    revalidatePath("/canales", "layout");
    return ok(result);
  } catch (error) {
    return toActionFailure(error);
  }
}
