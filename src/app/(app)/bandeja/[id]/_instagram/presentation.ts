// How the inbox shows Instagram's 24 h window ([BAN-18], [IG-04]): open, until when and how long is left; closed, why
// nothing can be sent. Unlike WhatsApp there are no templates: only the customer can open it again. Pure, for client
// components: open or closed is decided again with the screen's clock, so it closes on time while on screen.
import { formatDateTime } from "@/lib/format";
import { formatUntil, windowRemaining } from "../../_lib/presentation";

export const INSTAGRAM_WINDOW_CLOSED_TEXT = "Han pasado más de 24 horas desde el último mensaje del cliente: Instagram no deja responder hasta que vuelva a escribir.";
export const INSTAGRAM_NEVER_WROTE_TEXT = "El cliente todavía no ha escrito por Instagram, y el negocio no puede escribir primero.";

export type InstagramWindowView =
  | { state: "open"; closesAt: Date; text: string }
  | { state: "closed"; text: string; detail: string | null };

export function describeInstagramWindow(window: { open: boolean; closesAt: Date | null }, now: Date, timezone: string): InstagramWindowView {
  if (!window.closesAt) return { state: "closed", text: INSTAGRAM_NEVER_WROTE_TEXT, detail: null };
  if (!window.open || window.closesAt.getTime() <= now.getTime()) {
    return { state: "closed", text: INSTAGRAM_WINDOW_CLOSED_TEXT, detail: `Se cerró el ${formatDateTime(window.closesAt, timezone)}. Se abre de nuevo cuando el cliente escriba.` };
  }
  return {
    state: "open",
    closesAt: window.closesAt,
    text: `Puedes responder hasta ${formatUntil(window.closesAt, timezone, now)} · quedan ${windowRemaining(window.closesAt, now)}`,
  };
}
