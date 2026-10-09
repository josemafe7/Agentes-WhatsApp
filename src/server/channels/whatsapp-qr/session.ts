// The connection of ONE linked number ([QR-03], [QR-04], [QR-06]–[QR-10], docs/integracion-whatsapp-qr.md): it opens
// the socket with the stored session (or shows a QR code for a number that is not linked yet), keeps the credentials
// saved as they change, and turns what arrives into the common pipeline — a customer's message is ingested (the reply
// is scheduled, never the AI here, [CAN-10]), what the business wrote from its phone joins the conversation and pauses
// the AI, and the statuses of our messages move them forward. A dropped connection is opened again with growing waits;
// a session the phone closed (or WhatsApp withdrew) is erased, the channel goes to «error» and owner and admins are
// told. What arrives is handled one thing at a time, in order.
import "server-only";
import type { AuthenticationCreds } from "baileys";
import { and, eq } from "drizzle-orm";
import { assertWhatsAppNumberFree, WHATSAPP_NUMBER_TAKEN } from "@/data/whatsapp-numbers";
import { db } from "@/db";
import { channels, messages, type ChannelHealth } from "@/db/schema";
import { whatsappViaOf } from "@/lib/whatsapp-via";
import { ConflictError } from "@/server/errors";
import { ingestEvents } from "@/server/inbound/ingest";
import { applyStatusUpdate } from "@/server/inbound/status";
import { notify } from "@/server/notifications/notify";
import { safeErrorMessage } from "@/server/redact";
import { runInboundMediaDownload, type MediaDownloadContext } from "../media-download";
import { recordPhoneEcho } from "../phone-echo";
import type { ChannelRecord } from "../types";
import { createQrKeyStore, deleteQrKeys, deleteQrSession, isLinked, loadQrCreds, newQrCreds, saveQrCreds } from "./auth-store";
import { qrDisplayNumber, qrPhoneNumberId, readWhatsAppQrConfig, updateWhatsAppQrChannel } from "./config";
import { QR_NOT_OPEN, QR_SESSION_LOST, QR_SESSION_REPLACED, whatsappQrHealth } from "./health";
import { downloadAndStoreQrMedia, type QrMediaDeps } from "./media";
import { normalizeJid, normalizeQrMessage, qrDeliveryStatus, type QrMediaRef, type QrRawMessage } from "./normalize";
import type { QrOutbound, QrSendResult, QrSessionState, QrSessionStatus } from "./runtime";
import type { QrSocket, QrSocketFactory, QrSocketKey } from "./socket";

// The library's reasons for a closed connection (its DisconnectReason).
const LOGGED_OUT = 401;
const FORBIDDEN = 403;
const MULTIDEVICE_MISMATCH = 411;
const CONNECTION_REPLACED = 440;
/** After the QR is scanned WhatsApp closes the connection on purpose: a new one opens the linked session. */
const RESTART_REQUIRED = 515;
/** The session is gone for good: it has to be linked again. */
const SESSION_GONE: ReadonlySet<number> = new Set([LOGGED_OUT, FORBIDDEN, MULTIDEVICE_MISMATCH]);

export const RECONNECT_BASE_MS = 2_000;
export const RECONNECT_MAX_MS = 60_000;
const SEND_TIMEOUT_MS = 30_000;
const LOGOUT_TIMEOUT_MS = 10_000;
/** Time a file gets to download and, a voice note, to be transcribed. */
const MEDIA_BUDGET_MS = 90_000;
/** Ids of what this process sent, kept to tell them from what the phone sends. */
const MAX_SENT_IDS = 500;

const QR_EXPIRED = "El código QR ha caducado sin que nadie lo escaneara. Genera otro.";
const LINK_REFUSED = "WhatsApp no ha aceptado la vinculación. Genera otro código y vuelve a escanearlo.";
const NOT_LINKED = "Este número no está vinculado. Pulsa «Volver a vincular» y escanea el código.";
const SEND_FAILED = "No se ha podido enviar el mensaje por WhatsApp.";

type Cancelable = { cancel(): void };

export type QrSessionDeps = {
  openSocket: QrSocketFactory;
  now?: () => Date;
  /** Runs `run` after `ms` (setTimeout; tests make it immediate or hold it). */
  delay?: (run: () => void, ms: number) => Cancelable;
  /** Runs the job queue when a scheduled reply is due (there is no request to run it after). */
  tickAt?: (runAt: Date | null) => void;
  media?: QrMediaDeps;
  openRouterFetch?: typeof fetch;
};

type ConnectionUpdate = { connection?: "connecting" | "open" | "close"; qr?: string; lastDisconnect?: { error?: unknown } };
type MessagesUpsert = { messages?: QrRawMessage[] };
type MessageUpdate = { key?: QrSocketKey | null; update?: { status?: number | null } | null };

const defaultDelay = (run: () => void, ms: number): Cancelable => {
  const timer = setTimeout(run, ms);
  // A pending reconnection never keeps the process from stopping.
  timer.unref?.();
  return { cancel: () => clearTimeout(timer) };
};

/** The library closes with a Boom error: its HTTP-like status says why. */
function closeCodeOf(error: unknown): number | null {
  const code = (error as { output?: { statusCode?: unknown } } | null | undefined)?.output?.statusCode;
  return typeof code === "number" ? code : null;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error("error"));
      },
    );
  });
}

function socketContent(message: QrOutbound): Record<string, unknown> {
  // No link preview: building one would make the server fetch whatever address the text carries.
  if (message.kind === "text") return { text: message.text, linkPreview: null };
  const caption = "caption" in message && message.caption ? { caption: message.caption } : {};
  if (message.kind === "image") return { image: Buffer.from(message.bytes), mimetype: message.mimeType, ...caption };
  if (message.kind === "document") return { document: Buffer.from(message.bytes), mimetype: message.mimeType, fileName: message.fileName, ...caption };
  return { audio: Buffer.from(message.bytes), mimetype: message.mimeType, ptt: true };
}

export class QrSession {
  private socket: QrSocket | null = null;
  private creds: AuthenticationCreds | null = null;
  private status: QrSessionStatus;
  /** stop() or logout() was asked, or the session ended for good: nothing reconnects it. */
  private closed = false;
  /** This run started without a linked session: when it opens, the number has just been linked. */
  private pairing = false;
  private attempts = 0;
  private timer: Cancelable | null = null;
  /** Each socket has its number: what an older one still says is ignored. */
  private generation = 0;
  private work: Promise<void> = Promise.resolve();
  private readonly downloads = new Set<Promise<unknown>>();
  private readonly sentIds = new Set<string>();

  constructor(
    readonly channelId: string,
    private readonly deps: QrSessionDeps,
  ) {
    this.status = { state: "starting", qr: null, error: null, since: this.now().getTime() };
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  getStatus(): QrSessionStatus {
    return { ...this.status };
  }

  /** Tests: everything received so far has been handled, downloads included. */
  async idle(): Promise<void> {
    await this.work;
    await Promise.allSettled([...this.downloads]);
    await this.work;
  }

  private setState(state: QrSessionState, error: string | null = null, qr: string | null = null): void {
    this.status = { state, qr, error, since: this.now().getTime() };
  }

  /** One thing at a time, in the order it arrived; a failure is logged (never with what it carried) and the rest goes on. */
  private enqueue(task: () => Promise<void>): void {
    this.work = this.work.then(task).catch((error: unknown) => console.error(`[whatsapp-qr] Error al atender un aviso: ${safeErrorMessage(error)}`));
  }

  private async channel(): Promise<ChannelRecord | null> {
    const [row] = await db.select().from(channels).where(eq(channels.id, this.channelId));
    return row && whatsappViaOf(row) === "qr" && !row.isDemo ? row : null;
  }

  // ─── Opening and closing ──────────────────────────────────────────────────────────────────────────────

  /** `pairing`: a number without a linked session starts one and shows its QR code; without it, it stays unlinked. */
  async start(options: { pairing: boolean }): Promise<void> {
    const channel = await this.channel();
    if (!channel || channel.status === "disabled") {
      // Nothing to open: left as a session that is over, so a later start is not taken for a second connection.
      this.closed = true;
      this.setState("logged_out", NOT_LINKED);
      return;
    }
    const stored = loadQrCreds(channel);
    if (isLinked(stored)) {
      this.creds = stored;
    } else if (options.pairing) {
      // Whatever an unfinished attempt left is of no use to a new one.
      this.creds = newQrCreds();
      this.pairing = true;
      await deleteQrKeys(this.channelId);
      await saveQrCreds(this.channelId, this.creds);
    } else {
      this.closed = true;
      this.setState("logged_out", NOT_LINKED);
      return;
    }
    await this.connect();
  }

  private async connect(): Promise<void> {
    const creds = this.creds;
    if (this.closed || !creds) return;
    const generation = ++this.generation;
    this.setState(this.attempts > 0 ? "reconnecting" : "starting");
    let socket: QrSocket;
    try {
      socket = await this.deps.openSocket({ creds, keys: createQrKeyStore(this.channelId), getMessage: (key) => this.sentMessage(key) });
    } catch (error) {
      console.error(`[whatsapp-qr] No se ha podido abrir la conexión: ${safeErrorMessage(error)}`);
      this.scheduleReconnect();
      return;
    }
    if (this.closed || generation !== this.generation) {
      socket.end(undefined);
      return;
    }
    this.socket = socket;
    const current = () => generation === this.generation && !this.closed;
    socket.ev.on("creds.update", (update: Partial<AuthenticationCreds>) => {
      if (!current()) return;
      Object.assign(creds, update);
      this.enqueue(() => saveQrCreds(this.channelId, creds));
    });
    socket.ev.on("connection.update", (update: ConnectionUpdate) => {
      if (current()) this.enqueue(() => this.onConnection(update, generation));
    });
    socket.ev.on("messages.upsert", (upsert: MessagesUpsert) => {
      // Live messages («notify») and the ones delivered while the app was off («append») are both read ([QR-04]).
      if (current()) this.enqueue(() => this.onMessages(upsert.messages ?? []));
    });
    socket.ev.on("messages.update", (updates: MessageUpdate[]) => {
      if (current()) this.enqueue(() => this.onStatuses(updates));
    });
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    this.attempts += 1;
    this.setState("reconnecting");
    const wait = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** (this.attempts - 1));
    this.timer?.cancel();
    // A failed reconnection never takes the process down with it: it is logged and tried again.
    this.timer = (this.deps.delay ?? defaultDelay)(() => {
      this.connect().catch((error: unknown) => {
        console.error(`[whatsapp-qr] No se ha podido reconectar: ${safeErrorMessage(error)}`);
        this.scheduleReconnect();
      });
    }, wait);
  }

  private async onConnection(update: ConnectionUpdate, generation: number): Promise<void> {
    if (generation !== this.generation || this.closed) return;
    // The code is a secret that links the account: kept in memory for the wizard, never stored or logged ([QR-03]).
    if (update.qr) this.setState("pairing", null, update.qr);
    if (update.connection === "open") await this.onOpen();
    if (update.connection === "close") await this.onClose(closeCodeOf(update.lastDisconnect?.error));
  }

  private async onOpen(): Promise<void> {
    const channel = await this.channel();
    const me = this.socket?.user ?? this.creds?.me ?? null;
    const digits = normalizeJid(me?.id)?.split("@")[0] ?? null;
    if (!channel || !digits) return;
    const numberId = qrPhoneNumberId(digits);
    // A channel's conversations are one number's: another number is another channel.
    if (channel.phoneNumberId && channel.phoneNumberId !== numberId) {
      await this.refuse(channel, `Has escaneado con otro número (${qrDisplayNumber(digits)}). Este canal es del ${channel.displayPhoneNumber ?? "número anterior"}: vuelve a vincularlo con ese, o añade un canal nuevo para el otro.`);
      return;
    }
    try {
      await assertWhatsAppNumberFree(db, digits, { exceptChannelId: channel.id });
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error;
      await this.refuse(channel, WHATSAPP_NUMBER_TAKEN);
      return;
    }
    const now = this.now();
    this.attempts = 0;
    this.setState("open");
    await updateWhatsAppQrChannel(
      channel.id,
      // From now on, nothing older is a new message ([QR-06]).
      this.pairing ? { qrLinkedAt: now.toISOString() } : {},
      {
        phoneNumberId: numberId,
        displayPhoneNumber: qrDisplayNumber(digits),
        verifiedName: me?.name?.trim() || channel.verifiedName,
        status: "connected",
        lastHealth: whatsappQrHealth(this.status, { now, lastInboundAt: channel.lastInboundAt }),
        lastHealthAt: now,
      },
    );
    this.pairing = false;
  }

  private async onClose(code: number | null): Promise<void> {
    this.socket = null;
    if (this.closed) return;
    if (code === RESTART_REQUIRED) {
      await this.connect();
      return;
    }
    const linked = isLinked(this.creds) && !this.pairing;
    if (code !== null && SESSION_GONE.has(code)) {
      if (linked) await this.sessionLost();
      else await this.linkFailed(LINK_REFUSED);
      return;
    }
    if (code === CONNECTION_REPLACED) {
      this.end("replaced", QR_SESSION_REPLACED);
      await this.markError(QR_SESSION_REPLACED, "otra copia de la app ha tomado la sesión");
      return;
    }
    // Before the code is scanned there is nothing to reconnect to: WhatsApp stops offering codes after a while.
    if (!isLinked(this.creds)) {
      await this.linkFailed(QR_EXPIRED);
      return;
    }
    this.scheduleReconnect();
  }

  /** Nobody scanned the code, or WhatsApp refused the link: what the attempt left is of no use, and is not kept. */
  private async linkFailed(reason: string): Promise<void> {
    this.end("expired", reason);
    await deleteQrSession(this.channelId);
  }

  /** The session is over for this run: no reconnection. */
  private end(state: QrSessionState, error: string): void {
    this.closed = true;
    this.timer?.cancel();
    this.generation += 1;
    this.socket?.end(undefined);
    this.socket = null;
    this.setState(state, error);
  }

  private async markError(detail: string, what: string): Promise<void> {
    const channel = await this.channel();
    if (!channel) return;
    const now = this.now();
    const health: ChannelHealth = whatsappQrHealth(this.status, { now, lastInboundAt: channel.lastInboundAt });
    await db.update(channels).set({ status: "error", lastHealth: { ...health, error: detail }, lastHealthAt: now, updatedAt: now }).where(eq(channels.id, channel.id));
    await notify({ event: "channel_error", title: `WhatsApp «${channel.name}» (código QR): ${what}`, body: detail, link: `/canales/${channel.id}`, channelId: channel.id });
  }

  /** The phone closed the session, or WhatsApp withdrew it ([QR-10]): its keys are of no use any more. */
  private async sessionLost(): Promise<void> {
    this.end("logged_out", QR_SESSION_LOST);
    await deleteQrSession(this.channelId);
    await this.markError(QR_SESSION_LOST, "la sesión se ha cerrado");
  }

  /** The scanned phone cannot be this channel's ([QR-05]): the link just made is undone. */
  private async refuse(channel: ChannelRecord, reason: string): Promise<void> {
    const socket = this.socket;
    this.end("refused", reason);
    if (socket) await withTimeout(socket.logout(), LOGOUT_TIMEOUT_MS).catch(() => undefined);
    await deleteQrSession(this.channelId);
    const now = this.now();
    const health = whatsappQrHealth(this.status, { now, lastInboundAt: channel.lastInboundAt });
    await db.update(channels).set({ status: "error", lastHealth: { ...health, error: reason }, lastHealthAt: now, updatedAt: now }).where(eq(channels.id, channel.id));
  }

  /** Closes the connection and leaves the session linked (a disabled channel, the app stopping). */
  async stop(): Promise<void> {
    this.closed = true;
    this.timer?.cancel();
    this.generation += 1;
    this.socket?.end(undefined);
    this.socket = null;
    await this.work;
  }

  /** Closes the session in WhatsApp (it leaves the phone's linked devices) and erases it here ([QR-12]). */
  async logout(): Promise<{ loggedOut: boolean }> {
    const socket = this.socket;
    const open = this.status.state === "open";
    this.closed = true;
    this.timer?.cancel();
    let loggedOut = false;
    if (socket && open) {
      loggedOut = await withTimeout(socket.logout(), LOGOUT_TIMEOUT_MS).then(
        () => true,
        () => false,
      );
    }
    this.generation += 1;
    socket?.end(undefined);
    this.socket = null;
    // What was still being saved finishes first: nothing writes the session back after it is erased.
    await this.work;
    await deleteQrSession(this.channelId);
    this.setState("logged_out", NOT_LINKED);
    return { loggedOut };
  }

  // ─── Receiving ────────────────────────────────────────────────────────────────────────────────────────

  private async onMessages(rawMessages: QrRawMessage[]): Promise<void> {
    if (rawMessages.length === 0) return;
    const channel = await this.channel();
    // A disabled channel neither receives nor answers ([CAN-16]).
    if (!channel || channel.status === "disabled") return;
    const me = this.socket?.user ?? this.creds?.me ?? null;
    const self = { pn: me?.id ?? null, lid: me?.lid ?? null };
    const linked = readWhatsAppQrConfig(channel.config).qrLinkedAt;
    const linkedAt = linked && !Number.isNaN(Date.parse(linked)) ? new Date(linked) : null;
    let handled = false;
    let replyRunAt: Date | null = null;
    for (const raw of rawMessages) {
      try {
        const now = this.now();
        const normalized = normalizeQrMessage(raw, { self, linkedAt, receivedAt: now });
        if (normalized.kind === "inbound") {
          const result = await ingestEvents(channel, [normalized.event], { now });
          const stored = result.messages[0];
          handled = true;
          if (result.replyRunAt && (!replyRunAt || result.replyRunAt < replyRunAt)) replyRunAt = result.replyRunAt;
          if (normalized.media && stored?.messageId && !stored.duplicate && !stored.reaction) this.downloadSoon(channel, normalized.event.externalId, normalized.media);
        } else if (normalized.kind === "echo") {
          const id = normalized.echo.externalIds[0];
          // What this process sent is already in the conversation, as the AI's or a person's own.
          if (this.sentIds.has(id)) continue;
          const recorded = await recordPhoneEcho(channel, normalized.echo, { now });
          if (recorded.kind === "recorded" && normalized.media) this.downloadSoon(channel, id, normalized.media);
        }
      } catch (error) {
        console.error(`[whatsapp-qr] No se ha podido guardar un mensaje: ${safeErrorMessage(error)}`);
      }
    }
    if (handled) this.deps.tickAt?.(replyRunAt);
  }

  /** The file starts downloading at once; the reply waits for it (the download holds the conversation's lease). */
  private downloadSoon(channel: ChannelRecord, externalId: string, media: QrMediaRef): void {
    const context = { job: { id: crypto.randomUUID(), attempts: 1, maxAttempts: 1 }, remainingMs: () => MEDIA_BUDGET_MS } as MediaDownloadContext;
    const download = runInboundMediaDownload(
      { channel, externalId, download: () => downloadAndStoreQrMedia(media, this.deps.media), isFinal: () => true },
      context,
      { storage: this.deps.media?.storage, openRouterFetch: this.deps.openRouterFetch },
    )
      .then(() => this.deps.tickAt?.(null))
      .catch((error: unknown) => console.error(`[whatsapp-qr] No se ha podido descargar un archivo: ${safeErrorMessage(error)}`))
      .finally(() => this.downloads.delete(download));
    this.downloads.add(download);
  }

  private async onStatuses(updates: MessageUpdate[]): Promise<void> {
    const channel = await this.channel();
    if (!channel) return;
    for (const { key, update } of updates) {
      const status = qrDeliveryStatus(update?.status);
      if (!key?.fromMe || !key.id || !status) continue;
      const error = status === "failed" ? { message: "WhatsApp no ha podido entregar el mensaje." } : null;
      await applyStatusUpdate(channel, { kind: "status_update", externalId: key.id, status, at: this.now(), error });
    }
  }

  /** A text this channel sent, for when WhatsApp asks to send it again; anything else cannot be rebuilt. */
  private async sentMessage(key: QrSocketKey): Promise<Record<string, unknown> | undefined> {
    if (!key.id) return undefined;
    const [row] = await db
      .select({ text: messages.text, contentType: messages.contentType, direction: messages.direction })
      .from(messages)
      .where(and(eq(messages.channelId, this.channelId), eq(messages.externalId, key.id)));
    return row?.direction === "outbound" && row.contentType === "text" && row.text ? { conversation: row.text } : undefined;
  }

  // ─── Sending ──────────────────────────────────────────────────────────────────────────────────────────

  private remember(id: string): void {
    this.sentIds.add(id);
    if (this.sentIds.size > MAX_SENT_IDS) this.sentIds.delete(this.sentIds.values().next().value ?? id);
  }

  /** One message, once: a failure is never tried again by itself (a second try could reach the customer twice). */
  async send(jid: string, message: QrOutbound): Promise<QrSendResult> {
    const socket = this.socket;
    if (!socket || this.status.state !== "open") return { ok: false, error: QR_NOT_OPEN, retryable: false };
    try {
      const sent = await withTimeout(socket.sendMessage(jid, socketContent(message)), SEND_TIMEOUT_MS);
      const id = sent?.key?.id;
      if (!id) return { ok: false, error: SEND_FAILED, retryable: false };
      this.remember(id);
      // The account goes back to «not here», so the phone keeps getting its notifications.
      void socket
        .sendPresenceUpdate("paused", jid)
        .then(() => socket.sendPresenceUpdate("unavailable"))
        .catch(() => undefined);
      return { ok: true, externalId: id };
    } catch (error) {
      console.error(`[whatsapp-qr] Envío fallido: ${safeErrorMessage(error)}`);
      return { ok: false, error: SEND_FAILED, retryable: false };
    }
  }

  async typing(jid: string): Promise<void> {
    const socket = this.socket;
    if (!socket || this.status.state !== "open") return;
    // «escribiendo…» only shows from an account that is «here».
    await socket.sendPresenceUpdate("available").then(() => socket.sendPresenceUpdate("composing", jid));
  }

  async markRead(jid: string, messageId: string): Promise<void> {
    const socket = this.socket;
    if (!socket || this.status.state !== "open") return;
    await socket.readMessages([{ remoteJid: jid, id: messageId, fromMe: false }]);
  }
}
