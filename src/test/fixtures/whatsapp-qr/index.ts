// Realistic messages of a number linked by QR code, as the library delivers them (docs/integracion-whatsapp-qr.md,
// invented data), and a fake socket that the session drives in tests. Nothing here talks to WhatsApp.
import type { QrRawMessage } from "@/server/channels/whatsapp-qr/normalize";
import type { QrSocket, QrSocketFactory, QrSocketKey, QrSocketOptions } from "@/server/channels/whatsapp-qr/socket";

export const QR_TEST = {
  /** The linked account. */
  self: { pn: "34600111222:7@s.whatsapp.net", lid: "200300400500600:7@lid", digits: "34600111222", name: "Peluquería Ejemplo" },
  customer: { pn: "34611222333@s.whatsapp.net", lid: "111222333444555@lid", digits: "34611222333", name: "Ana Pruebas" },
  /** 2026-09-26T10:00:00Z, in seconds. */
  now: 1_790_416_800,
} as const;

let sequence = 0;
/** Ids like the ones WhatsApp gives messages: upper-case hex. */
export const qrMessageId = () => `3EB0${String((sequence += 1)).padStart(16, "0")}`;

type MessageOptions = { id?: string; fromMe?: boolean; remoteJid?: string; remoteJidAlt?: string | null; participant?: string; timestamp?: number | { toNumber(): number }; pushName?: string | null };

/** A message in the one-to-one chat with the test customer (addressed by LID, with the phone-number address next to it). */
export function qrMessage(message: Record<string, unknown> | null, options: MessageOptions = {}): QrRawMessage {
  return {
    key: {
      remoteJid: options.remoteJid ?? QR_TEST.customer.lid,
      ...(options.remoteJidAlt === null ? {} : { remoteJidAlt: options.remoteJidAlt ?? QR_TEST.customer.pn }),
      fromMe: options.fromMe ?? false,
      id: options.id ?? qrMessageId(),
      ...(options.participant ? { participant: options.participant } : {}),
    },
    messageTimestamp: options.timestamp ?? QR_TEST.now,
    ...(options.pushName === null ? {} : { pushName: options.pushName ?? QR_TEST.customer.name }),
    message,
  };
}

export const qrText = (text = "Hola, ¿tenéis hueco mañana?", options?: MessageOptions) => qrMessage({ conversation: text }, options);
export const qrLongText = (text: string, options?: MessageOptions) => qrMessage({ extendedTextMessage: { text, contextInfo: {} }, messageContextInfo: { deviceListMetadataVersion: 2 } }, options);

const MEDIA_KEY = new Uint8Array(32).fill(7);
export const qrVoice = (options?: MessageOptions) =>
  qrMessage({ audioMessage: { url: "https://mmg.whatsapp.net/v/t62/voz.enc", mimetype: "audio/ogg; codecs=opus", ptt: true, seconds: 4, fileLength: 9_210, mediaKey: MEDIA_KEY, directPath: "/v/t62.7117-24/voz.enc?ccb=11-4&oh=abc&oe=def" } }, options);
export const qrImage = (caption?: string, options?: MessageOptions) =>
  qrMessage({ imageMessage: { url: "https://mmg.whatsapp.net/v/t62/foto.enc", mimetype: "image/jpeg", fileLength: { toNumber: () => 98_000 }, mediaKey: MEDIA_KEY, directPath: "/v/t62.7118-24/foto.enc?ccb=11-4&oh=abc", ...(caption ? { caption } : {}) } }, options);
export const qrDocument = (options?: MessageOptions) =>
  qrMessage(
    { documentWithCaptionMessage: { message: { documentMessage: { mimetype: "application/pdf", fileName: "presupuesto.pdf", fileLength: 48_000, mediaKey: MEDIA_KEY, directPath: "/v/t62.7119-24/doc.enc?ccb=11-4", caption: "El presupuesto" } } } },
    options,
  );

/** A few bytes that start like a real file of each kind. */
export const OGG_BYTES = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4]);
export const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);

// ─── A fake connection ──────────────────────────────────────────────────────────────────────────────────


type Listener = (payload: never) => void;

/** What the session uses of the library's socket, driven by the test: it emits what WhatsApp would and records what is asked of it. */
export class FakeQrSocket implements QrSocket {
  private readonly listeners = new Map<string, Listener[]>();
  readonly sent: { jid: string; content: Record<string, unknown>; id: string }[] = [];
  readonly presence: [string, string | undefined][] = [];
  readonly read: QrSocketKey[][] = [];
  user: QrSocket["user"] = null;
  ended = false;
  loggedOut = false;
  /** Makes the next send fail, as a dropped connection would. */
  failSend = false;
  readonly ev = {
    on: (event: string, listener: Listener) => {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    },
  };

  constructor(readonly options: QrSocketOptions) {}

  emit(event: string, payload: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(payload as never);
  }

  /** WhatsApp offers a code to scan. */
  showQr(text = "https://wa.me/settings/linked_devices#CODIGO-DE-PRUEBA"): void {
    this.emit("connection.update", { qr: text });
  }

  /** Someone scanned the code: WhatsApp gives the account and closes the connection on purpose (515). */
  scanned(account: { id: string; lid: string; name?: string } = { id: QR_TEST.self.pn, lid: QR_TEST.self.lid, name: QR_TEST.self.name }): void {
    this.emit("creds.update", { me: account, registered: true });
    this.close(515);
  }

  open(account: { id: string; lid: string; name?: string } = { id: QR_TEST.self.pn, lid: QR_TEST.self.lid, name: QR_TEST.self.name }): void {
    this.user = account;
    this.emit("connection.update", { connection: "open" });
  }

  /** The connection closes with the library's reason (401 logged out, 408 timed out, 428 closed, 440 replaced, 515 restart). */
  close(code: number): void {
    this.emit("connection.update", { connection: "close", lastDisconnect: { error: { output: { statusCode: code } } } });
  }

  receive(messages: unknown[], type: "notify" | "append" = "notify"): void {
    this.emit("messages.upsert", { messages, type });
  }

  status(id: string, status: number): void {
    this.emit("messages.update", [{ key: { remoteJid: QR_TEST.customer.lid, id, fromMe: true }, update: { status } }]);
  }

  async sendMessage(jid: string, content: Record<string, unknown>) {
    if (this.failSend) throw new Error("Connection Closed");
    const id = qrMessageId();
    this.sent.push({ jid, content, id });
    return { key: { id } };
  }

  async sendPresenceUpdate(type: string, jid?: string) {
    this.presence.push([type, jid]);
  }

  async readMessages(keys: QrSocketKey[]) {
    this.read.push(keys);
  }

  async logout() {
    this.loggedOut = true;
  }

  end() {
    this.ended = true;
  }
}

/** A socket factory for the session: every connection it opens is kept, in order. */
export function fakeQrSockets() {
  const sockets: FakeQrSocket[] = [];
  const openSocket: QrSocketFactory = async (options) => {
    const socket = new FakeQrSocket(options);
    sockets.push(socket);
    return socket;
  };
  return { sockets, openSocket, latest: () => sockets[sockets.length - 1] };
}
