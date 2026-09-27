// Web Push hook ([PWA-03]–[PWA-05], docs/notificaciones-push.md). The PWA phase implements the sending with web-push
// and the VAPID keys; until then every push is skipped, so the rest of the notice (in-app, email) still works.
import "server-only";

export type PushPayload = { title: string; body: string | null; link: string | null };
export type PushOutcome = "sent" | "skipped";

export type PushSender = (userId: string, payload: PushPayload) => Promise<PushOutcome>;

const skip: PushSender = async () => "skipped";

// Survives dev hot reloads; the PWA phase registers the real sender.
const globalRef = globalThis as unknown as { __dominiaPushSender?: PushSender };

export function registerPushSender(sender: PushSender): void {
  globalRef.__dominiaPushSender = sender;
}

/** Sends the push to every device of the user (no-op until the PWA phase). Never throws for delivery problems. */
export async function deliverPush(userId: string, payload: PushPayload): Promise<PushOutcome> {
  return (globalRef.__dominiaPushSender ?? skip)(userId, payload);
}
