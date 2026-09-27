// The WhatsApp 24 h customer service window ([WA-43], [BAN-08], docs/integracion-whatsapp-mensajes.md §13). Pure, for
// the inbox (open or closed and how long is left) and the server. It opens with each customer message, counted from
// Meta's timestamp (conversations.last_inbound_at). If Meta answers 131047 while our count says «open», Meta wins:
// the webhook stores the time in `conversations.metadata.whatsappWindowClosedAt` and the window stays closed until
// the customer writes again.

/** The same 24 h as the reply engine's WINDOW_24H_MS (src/server/engine/checks.ts). */
export const WHATSAPP_WINDOW_MS = 24 * 60 * 60_000;
export const WINDOW_CLOSED_METADATA_KEY = "whatsappWindowClosedAt";

export type WhatsAppWindowState = {
  open: boolean;
  /** When it closes (or closed); null when the customer never wrote. */
  closesAt: Date | null;
  /** Milliseconds left while open, 0 when closed. */
  remainingMs: number;
  /** Closed because Meta said so (131047) although less than 24 h have passed. */
  closedByMeta: boolean;
};

function readClosedAt(metadata: Record<string, unknown> | null | undefined): Date | null {
  const value = metadata?.[WINDOW_CLOSED_METADATA_KEY];
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function whatsappWindowState(lastInboundAt: Date | null, now: Date, metadata?: Record<string, unknown> | null): WhatsAppWindowState {
  if (!lastInboundAt) return { open: false, closesAt: null, remainingMs: 0, closedByMeta: false };
  const closesAt = new Date(lastInboundAt.getTime() + WHATSAPP_WINDOW_MS);
  const closedAt = readClosedAt(metadata);
  const closedByMeta = closedAt !== null && closedAt.getTime() >= lastInboundAt.getTime();
  const remainingMs = closedByMeta ? 0 : Math.max(0, closesAt.getTime() - now.getTime());
  return { open: remainingMs > 0, closesAt, remainingMs, closedByMeta };
}
