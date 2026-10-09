// The linked sessions of this process ([QR-02], [QR-04], docs/integracion-whatsapp-qr.md «Dónde vive la sesión»). A
// number linked by QR code is one open connection to WhatsApp that someone has to keep alive: the web server's own
// process does (`pnpm dev`, `next start`), never a Vercel function. One supervisor per process, on globalThis: a
// compiled app carries its own copy of the server code in each route's bundle, and all of them must reach the same
// connections. What crosses between bundles is plain data only (never a class instance to compare with `instanceof`).
// This file has no library in it: the adapter and the screens import it, and the heavy part loads on first use.
import "server-only";

export type QrSessionState =
  /** Opening the connection. */
  | "starting"
  /** Showing a QR code to scan. */
  | "pairing"
  /** Linked and connected. */
  | "open"
  /** The connection dropped: opening it again by itself. */
  | "reconnecting"
  /** Nobody scanned the code in time. */
  | "expired"
  /** The phone closed the session or WhatsApp withdrew it: it has to be linked again. */
  | "logged_out"
  /** Another process opened this same session and took it. */
  | "replaced"
  /** The scanned phone is not this channel's number, or it is already in another channel. */
  | "refused";

export type QrSessionStatus = {
  state: QrSessionState;
  /** The text of the QR code to show while pairing. A secret that links the account: only ever in memory, never logged. */
  qr: string | null;
  /** Spanish explanation of what stopped the session, when something did. */
  error: string | null;
  /** Epoch milliseconds of the last change of state. */
  since: number;
};

/** One message to send, with its file already read. */
export type QrOutbound =
  | { kind: "text"; text: string }
  | { kind: "image"; bytes: Uint8Array; mimeType: string; caption: string | null }
  | { kind: "document"; bytes: Uint8Array; mimeType: string; fileName: string; caption: string | null }
  | { kind: "audio"; bytes: Uint8Array; mimeType: string };

export type QrSendResult = { ok: true; externalId: string } | { ok: false; error: string; retryable: boolean };

export type QrSupervisor = {
  /** Opens the session of every linked number that should be connected. Safe to call again. */
  startAll(): Promise<void>;
  /** Opens (or leaves open) the session of one channel; with `pairing` a number that is not linked shows a QR code. */
  start(channelId: string, options?: { pairing?: boolean }): Promise<void>;
  /** Closes the connection without closing the session in WhatsApp (a disabled channel, the app stopping). */
  stop(channelId: string): Promise<void>;
  /** Closes the session in WhatsApp and erases its keys. `loggedOut`: WhatsApp was told (the connection was open). */
  logout(channelId: string): Promise<{ loggedOut: boolean }>;
  /** null when this process holds no session of the channel. */
  status(channelId: string): QrSessionStatus | null;
  send(channelId: string, jid: string, message: QrOutbound): Promise<QrSendResult>;
  /** «escribiendo…» in that chat; a courtesy that never fails. */
  typing(channelId: string, jid: string): Promise<void>;
  markRead(channelId: string, jid: string, messageId: string): Promise<void>;
};

const SUPERVISOR = Symbol.for("dominia.whatsappQr.supervisor");
type WithSupervisor = typeof globalThis & { [SUPERVISOR]?: QrSupervisor };

/** The supervisor of this process if one was ever created (reading a status never creates it). */
export function existingQrSupervisor(): QrSupervisor | null {
  return (globalThis as WithSupervisor)[SUPERVISOR] ?? null;
}

/** The supervisor of this process, created on first use. */
export async function qrSupervisor(): Promise<QrSupervisor> {
  const holder = globalThis as WithSupervisor;
  const existing = holder[SUPERVISOR];
  if (existing) return existing;
  const { createQrSupervisor } = await import("./supervisor");
  // Two first calls at once: creating one starts nothing, and only the first is kept.
  return (holder[SUPERVISOR] ??= createQrSupervisor());
}

/** Tests only: puts a supervisor of their own (with a fake connection) in the process, or removes it. */
export function setQrSupervisorForTests(supervisor: QrSupervisor | null): void {
  const holder = globalThis as WithSupervisor;
  if (supervisor) holder[SUPERVISOR] = supervisor;
  else delete holder[SUPERVISOR];
}
