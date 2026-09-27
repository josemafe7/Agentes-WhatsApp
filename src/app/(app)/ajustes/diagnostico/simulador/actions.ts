"use server";
// Server Action of the channel simulator ([AJU-12], [AJU-13]): owner and admin write as a customer; the message goes
// through the real ingest pipeline (src/data/simulator.ts, which checks the permission again) and, once answered,
// the background work runs right away as after a real webhook ([MOT-15]).
import { revalidatePath } from "next/cache";
import { MAX_SIMULATOR_UPLOAD_BYTES, simulateInboundMessage } from "@/data/simulator";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { PERMISSIONS } from "@/lib/permissions";
import { toActionFailure } from "@/server/errors";
import { kickTick } from "@/server/inbound/ingest";
import { requirePermission } from "@/server/session";
import { simulatorInputFromFormData, type SimulatorUpload } from "./_lib/form";

/** Same as `maxDuration` in page.tsx: the reply that follows runs within this time. */
const MAX_DURATION_SEC = 60;
const SIMULATOR_PATH = "/ajustes/diagnostico/simulador";

export type SimulationView = {
  conversationId: string;
  contactId: string;
  contactName: string | null;
  channelName: string;
  duplicate: boolean;
  aiExpected: boolean;
  aiReason: string | null;
};

async function readUpload(formData: FormData): Promise<SimulatorUpload | ActionResult<SimulationView> | null> {
  if (formData.get("fileSource") !== "upload" || (formData.get("contentType") ?? "text") === "text") return null;
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("Revisa los campos marcados.", { file: ["Elige un archivo."] });
  if (file.size > MAX_SIMULATOR_UPLOAD_BYTES) return fail("Revisa los campos marcados.", { file: ["El archivo puede ocupar como mucho 1 MB."] });
  return { bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name.slice(0, 255) };
}

export async function simulateMessageAction(_previous: ActionResult<SimulationView> | undefined, formData: FormData): Promise<ActionResult<SimulationView>> {
  try {
    // The permission before touching the file ([SEG-04]); the data layer checks it again.
    const actor = await requirePermission(PERMISSIONS.settings.diagnostics);
    const upload = await readUpload(formData);
    if (upload && "ok" in upload) return upload;
    const result = await simulateInboundMessage(actor, simulatorInputFromFormData(formData, upload));
    if (result.replyRunAt) kickTick({ maxDurationSec: MAX_DURATION_SEC, runAt: result.replyRunAt });
    // New contacts appear in the picker for the next message.
    revalidatePath(SIMULATOR_PATH);
    return ok(
      {
        conversationId: result.conversationId,
        contactId: result.contactId,
        contactName: result.contactName,
        channelName: result.channelName,
        duplicate: result.duplicate,
        aiExpected: result.aiReply.expected,
        aiReason: result.aiReply.reason,
      },
      "Mensaje recibido.",
    );
  } catch (error) {
    return toActionFailure(error);
  }
}
