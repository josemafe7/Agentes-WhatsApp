// GET /api/push/icon?size=192|512[&purpose=maskable] ([PWA-01]): the icon of the installed app and of its push
// notices. Public, like the business logo: the browser fetches it without a session to install the app. Only the sizes
// the manifest lists; anything else is 400, so nobody can make the server draw other images.
import { parseAppIconQuery } from "@/components/pwa/app-icon";
import { loadBusinessSettings } from "@/data/settings";
import { errorResponse, ValidationError } from "@/server/errors";
import { renderAppIcon } from "../_lib/render-app-icon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The manifest's icon addresses carry ?v=…, which changes with the name, colour or logo: a cached copy is never stale there.
const CACHE_CONTROL = "public, max-age=86400";

export async function GET(request: Request): Promise<Response> {
  try {
    const query = parseAppIconQuery(new URL(request.url).searchParams);
    if (!query) throw new ValidationError("Tamaño de icono no válido.");
    const { name, color, logoFileKey } = await loadBusinessSettings();
    const icon = await renderAppIcon({ name, color, logoFileKey }, query);
    return new Response(icon, { headers: { "Content-Type": "image/png", "Cache-Control": CACHE_CONTROL } });
  } catch (error) {
    return errorResponse(error);
  }
}
