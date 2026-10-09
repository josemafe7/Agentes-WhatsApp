// Internal: the app's own worker asks the web server, which keeps the WhatsApp sessions linked by QR code, to send a
// message (or show «escribiendo…», or mark as read) through one of them ([QR-02], [QR-08], src/server/channels/
// whatsapp-qr/host.ts). Only with `Authorization: Bearer <CRON_SECRET>`, the secret the two processes already share
// for the background work, compared in constant time ([SEG-08]); every field is validated ([SEG-05]) and the file of a
// message is named by its storage key, never sent. Nobody else has a reason to call it: without the secret, 401.
import { isCronAuthorized } from "@/server/cron";
import { performQrRequest, qrHostRequestSchema } from "@/server/channels/whatsapp-qr/host";
import { safeErrorMessage } from "@/server/redact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A send waits for WhatsApp up to 30 s.
export const maxDuration = 60;

const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request): Promise<Response> {
  if (!isCronAuthorized(request.headers.get("authorization"))) return json({ error: "No autorizado." }, 401);
  const parsed = qrHostRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Petición no válida." }, 400);
  try {
    return json(await performQrRequest(parsed.data), 200);
  } catch (error) {
    console.error(`[whatsapp-qr] Error al atender una petición interna: ${safeErrorMessage(error)}`);
    return json({ ok: false, error: "No se ha podido enviar el mensaje por WhatsApp.", retryable: false }, 200);
  }
}
