// The state an email channel shows ([CAN-01], [CAN-15], [COR-22]): «Requiere reconexión» (status `error` with that
// reason in last_health, docs/modelo-de-datos.md) when access expired, was revoked or the password changed, with a
// notice to owner and admins once; «error» after several failed polls in a row; «conectado» again after a good poll.
// Also the Diagnóstico counters of ignored mail ([COR-16]). System code.
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { channels, type ChannelHealth } from "@/db/schema";
import { notify } from "@/server/notifications/notify";
import { safeErrorMessage } from "@/server/redact";
import type { ChannelRecord } from "../types";
import { updateEmailConfig } from "./config";
import { MAX_SYNC_FAILURES } from "./constants";
import type { IgnoreReason } from "./filters";

export const RECONNECT_LABEL = "Requiere reconexión";

export type HealthCheck = ChannelHealth["checks"][number];

/** Thrown when the mailbox cannot be reached until someone connects it again ([COR-22]). */
export class EmailReconnectError extends Error {
  constructor(readonly reason: string) {
    super(`${RECONNECT_LABEL}: ${reason}`);
    this.name = "EmailReconnectError";
  }
}

export function reconnectHealth(reason: string, now: Date): ChannelHealth {
  return { checkedAt: now.toISOString(), checks: [{ key: "connection", status: "error", detail: reason }], error: `${RECONNECT_LABEL}: ${reason}` };
}

/** The channel needs a new connection: status error, the reason, and one notice to owner and admins. */
export async function markReconnectRequired(channel: Pick<ChannelRecord, "id" | "name">, reason: string, now: Date = new Date()): Promise<void> {
  let already = false;
  await updateEmailConfig(
    channel.id,
    (current) => {
      already = current.reconnect !== null && current.reconnect !== undefined;
      return { reconnect: current.reconnect ?? { at: now.toISOString(), reason } };
    },
    { extra: { status: "error", lastHealth: reconnectHealth(reason, now), lastHealthAt: now } },
  );
  if (already) return;
  await notify({
    event: "channel_error",
    title: `Correo «${channel.name}»: ${RECONNECT_LABEL.toLowerCase()}`,
    body: reason,
    link: `/canales/${channel.id}`,
    channelId: channel.id,
  });
}

/** After a good poll: last read, connection ok, and «conectado» again unless it waits for a reconnection. */
export async function recordSyncSuccess(channel: Pick<ChannelRecord, "id" | "status">, now: Date, extraChecks: HealthCheck[] = []): Promise<void> {
  const health: ChannelHealth = {
    checkedAt: now.toISOString(),
    checks: [
      { key: "connection", status: "ok", detail: "Conectado" },
      { key: "last_read", status: "ok", detail: `Última lectura: ${now.toISOString()}` },
      ...extraChecks,
    ],
  };
  const status = channel.status === "error" || channel.status === "connecting" ? "connected" : channel.status;
  // A send may have found the access revoked while this poll ran: then nothing here hides «Requiere reconexión».
  await updateEmailConfig(channel.id, (current) => (current.reconnect ? {} : { lastSyncAt: now.toISOString(), syncFailures: 0 }), {
    extra: (current) => (current.reconnect ? {} : { status, lastHealth: health, lastHealthAt: now }),
  });
}

/** A poll failed for a reason that may pass: after MAX_SYNC_FAILURES in a row, «error» and a notice ([CAN-15]). */
export async function recordSyncFailure(channel: Pick<ChannelRecord, "id" | "name">, error: unknown, now: Date): Promise<void> {
  const detail = error instanceof Error && "userMessage" in error && typeof error.userMessage === "string" ? error.userMessage : safeErrorMessage(error, 300);
  let failures = 0;
  await updateEmailConfig(channel.id, (current) => {
    failures = current.syncFailures + 1;
    return { syncFailures: failures };
  });
  if (failures !== MAX_SYNC_FAILURES) return;
  const health: ChannelHealth = { checkedAt: now.toISOString(), checks: [{ key: "connection", status: "error", detail }], error: detail };
  await db.update(channels).set({ status: "error", lastHealth: health, lastHealthAt: now, updatedAt: now }).where(eq(channels.id, channel.id));
  await notify({ event: "channel_error", title: `Correo «${channel.name}»: no se puede leer el buzón`, body: detail, link: `/canales/${channel.id}`, channelId: channel.id });
}

/** One more ignored email with this reason, for Diagnóstico ([COR-16]). */
export async function countIgnored(channelId: string, reason: IgnoreReason, amount = 1): Promise<void> {
  await updateEmailConfig(channelId, (current) => ({ ignored: { ...current.ignored, [reason]: (current.ignored[reason] ?? 0) + amount } }));
}
