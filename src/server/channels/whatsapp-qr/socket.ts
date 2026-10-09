// The one place that opens a connection to WhatsApp with the library ([QR-03], [QR-04], docs/integracion-whatsapp-qr.md
// «Conexión»). Everything else works with the small QrSocket shape below, so the session can be driven by a fake in
// tests. Settings chosen on purpose: no full history (old chats are never read), never «en línea» by itself (the phone
// keeps ringing), no link previews (they would make the server fetch addresses a message brings) and the library's own
// logs silenced: they may carry phone numbers, message ids or keys ([SEG-02]).
import "server-only";
import type { AuthenticationCreds, SignalKeyStore } from "baileys";
import { safeErrorMessage } from "@/server/redact";

/** The fields of the library's message key this app uses. */
export type QrSocketKey = { remoteJid?: string | null; id?: string | null; fromMe?: boolean | null };

/** What the session uses of the library's socket. */
export type QrSocket = {
  ev: { on(event: string, listener: (payload: never) => void): void };
  user?: { id?: string | null; lid?: string | null; name?: string | null } | null;
  sendMessage(jid: string, content: Record<string, unknown>): Promise<{ key?: { id?: string | null } | null } | undefined>;
  sendPresenceUpdate(type: "available" | "unavailable" | "composing" | "paused", jid?: string): Promise<void>;
  readMessages(keys: QrSocketKey[]): Promise<void>;
  logout(): Promise<void>;
  end(error: Error | undefined): void;
};

export type QrSocketOptions = {
  creds: AuthenticationCreds;
  keys: SignalKeyStore;
  /** A message we sent, for when WhatsApp asks to send it again; undefined when it cannot be rebuilt. */
  getMessage: (key: QrSocketKey) => Promise<Record<string, unknown> | undefined>;
};

export type QrSocketFactory = (options: QrSocketOptions) => Promise<QrSocket>;

type LogFn = (first: unknown, second?: unknown) => void;
const silent: LogFn = () => undefined;
/**
 * Only that something failed and the library's own fixed text: never the object it logs next to it, and no run of
 * digits (a phone number or an id that a text might carry).
 */
const errorLine: LogFn = (first, second) => {
  const text = typeof second === "string" ? second : typeof first === "string" ? first : null;
  if (text) console.error(`[whatsapp-qr] ${safeErrorMessage(new Error(text.slice(0, 200).replace(/\d{6,}/g, "…")))}`);
};
const logger = { level: "error", trace: silent, debug: silent, info: silent, warn: silent, error: errorLine, child: () => logger };

export const openQrSocket: QrSocketFactory = async ({ creds, keys, getMessage }) => {
  const { default: makeWASocket, makeCacheableSignalKeyStore } = await import("baileys");
  const socket = makeWASocket({
    auth: { creds, keys: makeCacheableSignalKeyStore(keys, logger) },
    logger,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    // What this socket sends is already stored by the app: only what the phone sends comes back as an event ([QR-09]).
    emitOwnEvents: false,
    generateHighQualityLinkPreview: false,
    getMessage: async (key) => (await getMessage(key)) as Awaited<ReturnType<NonNullable<Parameters<typeof makeWASocket>[0]["getMessage"]>>>,
  });
  return socket as unknown as QrSocket;
};
