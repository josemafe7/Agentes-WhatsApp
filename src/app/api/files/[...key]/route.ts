// Serves stored files (FileStorage: disk or private Vercel Blob) after checking who asks ([SEG-04], [MED-08]).
// Files never have public URLs: this route is the only way to read them. Rules and headers: ./serve.ts. Audio and
// video also answer byte ranges (206), which Safari and iOS ask for before playing them; always after the checks.
import { z } from "zod";
import { getFileStorage, isValidFileKey } from "@/server/adapters/file-storage";
import { messageMediaFileName } from "@/server/media/store";
import { safeErrorMessage } from "@/server/redact";
import { getActor } from "@/server/session";
import { acceptsRanges, fileResponseHeaders, parseRange, resolveFileAccess, sliceStream } from "./serve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ key: z.array(z.string().min(1).max(200)).min(1).max(8) });

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

const notFound = () => Response.json({ error: "No se ha encontrado." }, { status: 404, headers: PRIVATE_NO_STORE });

export async function GET(request: Request, context: { params: Promise<{ key: string[] }> }): Promise<Response> {
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
    const headers = fileResponseHeaders(file, access, downloadName);
    if (!acceptsRanges(file.contentType)) return new Response(file.stream, { status: 200, headers });

    const ranged = { ...headers, "Accept-Ranges": "bytes" };
    // No validators are sent (ETag, Last-Modified), so a conditional range never matches: the whole file.
    const range = request.headers.has("if-range") ? null : parseRange(request.headers.get("range"), file.size);
    if (range === null) return new Response(file.stream, { status: 200, headers: ranged });
    if (range === "unsatisfiable") {
      await file.stream.cancel();
      return new Response(null, { status: 416, headers: { ...ranged, "Content-Range": `bytes */${file.size}`, "Content-Length": "0" } });
    }
    return new Response(sliceStream(file.stream, range), {
      status: 206,
      headers: { ...ranged, "Content-Range": `bytes ${range.start}-${range.end}/${file.size}`, "Content-Length": String(range.end - range.start + 1) },
    });
  } catch (error) {
    // Generic answer only: no key, path or storage details ([SEG-14]).
    console.error(`[files] No se ha podido servir un archivo: ${safeErrorMessage(error)}`);
    return Response.json({ error: "Algo ha fallado. Inténtalo de nuevo." }, { status: 500, headers: PRIVATE_NO_STORE });
  }
}
