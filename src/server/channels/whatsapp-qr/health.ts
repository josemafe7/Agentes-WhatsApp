// The traffic lights of a number linked by QR code ([QR-11], [CAN-15]): the session with WhatsApp, as this process sees
// it right now; whether the app can keep a connection open at all ([QR-02]); and the last message. No outside call:
// the session is this process's own. Each light is green, amber or red, with a Spanish explanation.
import "server-only";
import type { ChannelHealth } from "@/db/schema";
import { whatsappQrUnsupportedReason } from "./config";
import type { QrSessionState, QrSessionStatus } from "./runtime";

type Check = ChannelHealth["checks"][number];

/** Spanish names of the lights, in the panel's order. */
export const WHATSAPP_QR_HEALTH_LABELS = {
  session: "Sesión de WhatsApp",
  process: "App encendida",
  last_message: "Último mensaje",
} as const;
export type WhatsAppQrHealthKey = keyof typeof WHATSAPP_QR_HEALTH_LABELS;

export const QR_SESSION_LOST = "El móvil cerró la sesión o WhatsApp la retiró: el número ya no está vinculado. Pulsa «Volver a vincular» y escanea un código nuevo.";
export const QR_SESSION_REPLACED =
  "Otra copia de la app ha abierto esta misma sesión y la ha sustituido. Comprueba que la app no esté arrancada dos veces y pulsa «Reconectar».";
export const QR_NOT_OPEN = "La sesión de WhatsApp de este número no está abierta ahora mismo: no se puede enviar. Mira el panel del canal.";
const NO_SESSION = "La app no tiene abierta la sesión de este número. Pulsa «Reconectar»; si no vuelve, «Volver a vincular».";

const SESSION: Record<QrSessionState, { status: Check["status"]; detail: string }> = {
  open: { status: "ok", detail: "Sesión abierta: el número está vinculado como un dispositivo más de tu WhatsApp." },
  starting: { status: "warn", detail: "Conectando con WhatsApp…" },
  reconnecting: { status: "warn", detail: "Se ha cortado la conexión con WhatsApp: la app la está recuperando sola. Si dura más de unos minutos, revisa la conexión a internet." },
  pairing: { status: "warn", detail: "Esperando a que escanees el código QR con el móvil." },
  expired: { status: "warn", detail: "El código QR caducó sin que nadie lo escaneara. Pulsa «Volver a vincular» para generar otro." },
  logged_out: { status: "error", detail: QR_SESSION_LOST },
  replaced: { status: "error", detail: QR_SESSION_REPLACED },
  refused: { status: "error", detail: "No se ha podido vincular con ese móvil. Pulsa «Volver a vincular»." },
};

/** These make the channel unusable: its status becomes «error». */
const BLOCKING: ReadonlySet<QrSessionState> = new Set(["logged_out", "replaced", "refused"]);

/** The lights from what this process knows of the session (null: it holds none). */
export function whatsappQrHealth(status: QrSessionStatus | null, context: { now: Date; lastInboundAt: Date | null; env?: NodeJS.ProcessEnv }): ChannelHealth {
  const unsupported = whatsappQrUnsupportedReason(context.env);
  const session: Check = status
    ? { key: "session", status: SESSION[status.state].status, detail: status.error ?? SESSION[status.state].detail }
    : { key: "session", status: "error", detail: NO_SESSION };
  const process: Check = unsupported
    ? { key: "process", status: "error", detail: unsupported }
    : { key: "process", status: "ok", detail: "La app mantiene abierta la conexión. Mientras esté apagada, el número no recibe ni contesta aquí (sigue funcionando en tu móvil)." };
  const last: Check = context.lastInboundAt
    ? { key: "last_message", status: "ok", detail: `Último mensaje recibido el ${context.lastInboundAt.toISOString()}.` }
    : { key: "last_message", status: "off", detail: "Aún no ha llegado ningún mensaje." };
  const failing = [session, process].find((check) => check.status === "error");
  return { checkedAt: context.now.toISOString(), checks: [session, process, last], ...(failing ? { error: failing.detail } : {}) };
}

export const isBlockingQrState = (state: QrSessionState): boolean => BLOCKING.has(state);
