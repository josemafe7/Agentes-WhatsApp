// A file uploaded to a knowledge base ([CON-04], [CON-14], [SEG-13]): the raw file is the body and its name goes in
// the FILE_NAME_HEADER header. Served by src/app/api/knowledge/bases/[id]/files/route.ts: a Server Action takes at
// most 4 MB here, and the proxy, which does not run on /api/, would keep only the first 10 MB of a bigger body.
// Checks here: same origin (the session cookie travels with it, [SEG-06]), session and permission ([SEG-04]), a
// limit per person ([SEG-07]) and the size before reading the whole body. src/data checks the permission again,
// the real type by content and duplicates, and stores it with a generated key.
import "server-only";
import { addKnowledgeFile } from "@/data/knowledge-documents";
import { PERMISSIONS } from "@/lib/permissions";
import { readBodyWithLimit } from "@/server/channels/webchat/upload";
import { AuthError, errorResponse, ValidationError } from "@/server/errors";
import { MAX_KB_FILE_BYTES } from "@/server/knowledge/constants";
import { KNOWLEDGE_MESSAGES } from "@/server/knowledge/errors";
import { requirePermission } from "@/server/session";
import { FILE_NAME_HEADER } from "./paths";
import { enforceKnowledgeAddLimit, startKnowledgeWork } from "./work";

const MAX_FILE_NAME_CHARS = 255;

/** Like Next.js does for Server Actions: the page that sends it must be this same site (host or proxy's host). */
export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host") || new URL(request.url).host;
  return originHost.toLowerCase() === host.toLowerCase();
}

function fileNameOf(request: Request): string {
  const raw = request.headers.get(FILE_NAME_HEADER);
  let name = "";
  try {
    name = raw ? decodeURIComponent(raw).replace(/[\p{Cc}]/gu, "").trim() : "";
  } catch {
    name = "";
  }
  if (!name || name.length > MAX_FILE_NAME_CHARS) throw new ValidationError("No se ha podido leer el nombre del archivo. Vuelve a elegirlo.");
  return name;
}

export async function handleKnowledgeUpload(request: Request, params: Promise<{ id: string }>): Promise<Response> {
  try {
    if (!isSameOriginRequest(request)) throw new AuthError("forbidden");
    const actor = await requirePermission(PERMISSIONS.knowledge.manage);
    const { id } = await params;
    const fileName = fileNameOf(request);
    await enforceKnowledgeAddLimit(actor.userId);
    const bytes = await readBodyWithLimit(request, MAX_KB_FILE_BYTES);
    if (!bytes) {
      return Response.json({ error: KNOWLEDGE_MESSAGES.fileTooLarge(Math.round(MAX_KB_FILE_BYTES / 1024 / 1024)), code: "too_large" }, { status: 413 });
    }
    const document = await addKnowledgeFile(actor, id, { fileName, bytes });
    startKnowledgeWork();
    return Response.json({ id: document.id, message: "Archivo añadido. Se está procesando." }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
