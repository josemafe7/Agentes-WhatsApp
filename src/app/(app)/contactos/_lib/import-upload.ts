// «Importar contactos» ([CTO-11]): the file goes as the raw body of src/app/api/contacts/import/route.ts, its name in
// the FILE_NAME_HEADER header and the step, the phone prefix and the confirmation in the query. Not a Server Action:
// those take 4 MB and the file may have 5 (4 on Vercel, where a request carries at most 4.5 MB). Checks here, as the
// knowledge upload does: same origin ([SEG-06]), session and permission ([SEG-04]) and the size before reading the
// whole body; src/data/contacts-import.ts checks the permission again, counts the uses per person and reads the file.
import "server-only";
import { revalidatePath } from "next/cache";
import { importContacts, previewContactImport } from "@/data/contacts-import";
import { MAX_IMPORT_BYTES } from "@/lib/contact-import";
import { PERMISSIONS } from "@/lib/permissions";
import { readBodyWithLimit } from "@/server/channels/webchat/upload";
import { AuthError, errorResponse, ValidationError } from "@/server/errors";
import { requirePermission } from "@/server/session";
import { isSameOriginRequest } from "../../conocimiento/_lib/upload";
import { CONTACTS_PATH } from "./search-params";

export const IMPORT_FILE_NAME_HEADER = "x-file-name";
const MAX_FILE_NAME_CHARS = 255;
const MAX_BYTES_ON_VERCEL = 4 * 1024 * 1024;

/** Largest file where the app runs: the screen says it and the route checks it. */
export function importMaxBytes(env: Record<string, string | undefined> = process.env): number {
  return env.VERCEL ? MAX_BYTES_ON_VERCEL : MAX_IMPORT_BYTES;
}

function fileNameOf(request: Request): string {
  const raw = request.headers.get(IMPORT_FILE_NAME_HEADER);
  let name = "";
  try {
    name = raw ? decodeURIComponent(raw).replace(/[\p{Cc}]/gu, "").trim() : "";
  } catch {
    name = "";
  }
  if (!name || name.length > MAX_FILE_NAME_CHARS) throw new ValidationError("No se ha podido leer el nombre del archivo. Vuelve a elegirlo.");
  return name;
}

export async function handleContactImport(request: Request, env: Record<string, string | undefined> = process.env): Promise<Response> {
  try {
    if (!isSameOriginRequest(request)) throw new AuthError("forbidden");
    const actor = await requirePermission(PERMISSIONS.contacts.import);
    const query = new URL(request.url).searchParams;
    const step = query.get("paso");
    if (step !== "revisar" && step !== "importar") throw new ValidationError("Falta saber si es revisar o importar.");
    const name = fileNameOf(request);
    const maxBytes = importMaxBytes(env);
    const bytes = await readBodyWithLimit(request, maxBytes);
    if (!bytes) return Response.json({ error: `El archivo pasa de ${Math.round(maxBytes / 1024 / 1024)} MB. Divídelo en varios.`, code: "too_large" }, { status: 413 });
    const options = { prefix: query.get("prefijo") ?? "", confirmPermissions: query.get("confirmar") === "1" };
    if (step === "revisar") return Response.json(await previewContactImport(actor, { name, bytes }, { prefix: options.prefix }));
    const result = await importContacts(actor, { name, bytes }, options);
    revalidatePath(CONTACTS_PATH);
    return Response.json(result);
  } catch (error) {
    // The prefix and the confirmation are said next to their field.
    if (error instanceof ValidationError && error.fieldErrors) return Response.json({ error: error.userMessage, code: error.code, fieldErrors: error.fieldErrors }, { status: error.status });
    return errorResponse(error);
  }
}
