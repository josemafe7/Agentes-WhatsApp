// The linked sessions this process keeps open ([QR-02], [QR-04]): one QrSession per channel. Created once per process
// through runtime.ts (never imported directly by a screen: this file brings the library with it). It decides which
// channels may have a session at all — real numbers linked by QR code, not disabled, and never on Vercel — and makes
// sure there is at most ONE connection per number here: two with the same session would throw each other out.
import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { channels } from "@/db/schema";
import { whatsappViaOf } from "@/lib/whatsapp-via";
import { tick } from "@/server/jobs/tick";
import { safeErrorMessage } from "@/server/redact";
import type { ChannelRecord } from "../types";
import { isLinked, loadQrCreds } from "./auth-store";
import { whatsappQrUnsupportedReason } from "./config";
import { QR_NOT_OPEN } from "./health";
import type { QrSessionState, QrSupervisor } from "./runtime";
import { QrSession, type QrSessionDeps } from "./session";
import { openQrSocket } from "./socket";

/** Time the queue gets when a message has just arrived (a reply with its AI call). */
const TICK_BUDGET_MS = 60_000;
/** The reply job is due at an exact moment: run a little after it. */
const TICK_LATE_MS = 250;
/** A session in one of these states is alive: starting it again would open a second connection. */
const ALIVE: ReadonlySet<QrSessionState> = new Set(["starting", "pairing", "open", "reconnecting"]);

/** There is no request to run the queue after (a message arrives by the open connection): a timer does it. */
function tickAt(runAt: Date | null): void {
  const wait = Math.max(0, (runAt?.getTime() ?? 0) - Date.now()) + TICK_LATE_MS;
  const timer = setTimeout(() => {
    tick({ budgetMs: TICK_BUDGET_MS, workerId: `whatsapp-qr-${crypto.randomUUID()}` }).catch((error: unknown) => console.error(`[whatsapp-qr] No se ha podido lanzar el trabajo en segundo plano: ${safeErrorMessage(error)}`));
  }, wait);
  timer.unref?.();
}

async function qrChannel(channelId: string): Promise<ChannelRecord | null> {
  const [row] = await db.select().from(channels).where(eq(channels.id, channelId));
  return row && whatsappViaOf(row) === "qr" && !row.isDemo ? row : null;
}

export function createQrSupervisor(deps: Partial<QrSessionDeps> = {}): QrSupervisor & { /** Tests: the session object of a channel. */ sessionOf(channelId: string): QrSession | null } {
  const sessions = new Map<string, QrSession>();
  const sessionDeps: QrSessionDeps = { openSocket: openQrSocket, tickAt, ...deps };

  async function start(channelId: string, options: { pairing?: boolean } = {}): Promise<void> {
    if (whatsappQrUnsupportedReason()) return;
    const existing = sessions.get(channelId);
    if (existing && ALIVE.has(existing.getStatus().state)) return;
    const channel = await qrChannel(channelId);
    if (!channel || channel.status === "disabled") return;
    await existing?.stop();
    const session = new QrSession(channelId, sessionDeps);
    sessions.set(channelId, session);
    await session.start({ pairing: options.pairing ?? false });
  }

  return {
    start,

    async startAll() {
      if (whatsappQrUnsupportedReason()) return;
      const rows = await db
        .select()
        .from(channels)
        .where(and(eq(channels.type, "whatsapp"), eq(channels.connectionMode, "qr"), eq(channels.isDemo, false)));
      for (const row of rows) {
        // Only numbers that are linked: one that never finished linking waits for a person to scan a code.
        if (row.status === "disabled" || row.status === "draft" || !isLinked(loadQrCreds(row))) continue;
        await start(row.id).catch((error: unknown) => console.error(`[whatsapp-qr] No se ha podido abrir una sesión: ${safeErrorMessage(error)}`));
      }
    },

    async stop(channelId) {
      const session = sessions.get(channelId);
      sessions.delete(channelId);
      await session?.stop();
    },

    async logout(channelId) {
      const session = sessions.get(channelId) ?? new QrSession(channelId, sessionDeps);
      sessions.delete(channelId);
      return session.logout();
    },

    status(channelId) {
      return sessions.get(channelId)?.getStatus() ?? null;
    },

    async send(channelId, jid, message) {
      const session = sessions.get(channelId);
      return session ? session.send(jid, message) : { ok: false, error: QR_NOT_OPEN, retryable: false };
    },

    async typing(channelId, jid) {
      await sessions.get(channelId)?.typing(jid);
    },

    async markRead(channelId, jid, messageId) {
      await sessions.get(channelId)?.markRead(jid, messageId);
    },

    sessionOf(channelId) {
      return sessions.get(channelId) ?? null;
    },
  };
}
