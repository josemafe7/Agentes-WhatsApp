// Serves stored files (FileStorage: disk or private Vercel Blob) after checking who asks ([SEG-04], [MED-08]).
// Files never have public URLs: this route is the only way to read them. Rules and headers: ./serve.ts.
import { z } from "zod";
import { getFileStorage, isValidFileKey } from "@/server/adapters/file-storage";
import { messageMediaFileName } from "@/server/media/store";
import { safeErrorMessage } from "@/server/redact";
import { getActor } from "@/server/session";
import { fileResponseHeaders, resolveFileAccess } from "./serve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ key: z.array(z.string().min(1).max(200)).min(1).max(8) });

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

const notFound = () => Response.json({ error: "No se ha encontrado." }, { status: 404, headers: PRIVATE_NO_STORE });

export async function GET(_request: Request, context: { params: Promise<{ key: string[] }> }): Promise<Response> {
  try {
    const params = paramsSchema.safeParse(await context.params);
    const key = params.success ? params.data.key.join("/") : "";
    if (!isValidFileKey(key)) return notFound();

    const access = await resolveFileAccess(key, await getActor());
    if (access === "unauthenticated") {
      return Response.json({ error: "Inicia sesión para ver este archivo." }, { status: 401, headers: PRIVATE_NO_STORE });
    }
    if (access === "not_found") return notFound();

    // The original name of a message file (media/, webchat/… keys), for its download. Looked up before opening the
    // file, so a failure here never leaves a stream open.
    const downloadName = access === "private" ? await messageMediaFileName(key) : null;
    const file = await getFileStorage().get(key);
    if (!file) return notFound();
    return new Response(file.stream, { status: 200, headers: fileResponseHeaders(file, access, downloadName) });
  } catch (error) {
    // Generic answer only: no key, path or storage details ([SEG-14]).
    console.error(`[files] No se ha podido servir un archivo: ${safeErrorMessage(error)}`);
    return Response.json({ error: "Algo ha fallado. Inténtalo de nuevo." }, { status: 500, headers: PRIVATE_NO_STORE });
  }
}
