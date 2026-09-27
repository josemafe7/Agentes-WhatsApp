// «Otro (IMAP/SMTP)» (ImapFlow + Nodemailer, [COR-10]–[COR-13]): the provider part of the email adapter.
import "server-only";
import type { ChannelHealth } from "@/db/schema";
import { readEmailConfig } from "../config";
import type { EmailProvider } from "../provider";
import { EmailReconnectError, reconnectHealth } from "../status";
import { revalidateImap } from "./connect";
import { closeImap, openImap } from "./connection";
import { describeMailError } from "./errors";
import { createImapDraft, deleteImapDraft, sendImap } from "./send";
import { imapSettingsOf } from "./settings";

export const imapProvider: EmailProvider = {
  type: "email_imap",
  send: sendImap,
  createDraft: createImapDraft,
  deleteDraft: deleteImapDraft,
  async healthCheck(channel, deps): Promise<ChannelHealth> {
    const now = deps.now?.() ?? new Date();
    const config = readEmailConfig(channel.config);
    if (config.reconnect) return reconnectHealth(config.reconnect.reason, now);
    try {
      const client = await openImap(imapSettingsOf(channel).imap, deps.mailConnectors);
      await closeImap(client);
      return {
        checkedAt: now.toISOString(),
        checks: [
          { key: "connection", status: "ok", detail: `Conectado a ${config.imap.imapHost ?? "IMAP"}` },
          config.lastSyncAt ? { key: "last_read", status: "ok", detail: `Última lectura: ${config.lastSyncAt}` } : { key: "last_read", status: "warn", detail: "Todavía no se ha leído el buzón." },
          config.imap.sentPath ? { key: "folders", status: "ok", detail: `Enviados: ${config.imap.sentPath}` } : { key: "folders", status: "warn", detail: "No se ha encontrado la carpeta de enviados." },
        ],
      };
    } catch (error) {
      if (error instanceof EmailReconnectError) return reconnectHealth(error.reason, now);
      const info = describeMailError(error);
      return info.reconnect ? reconnectHealth(info.message, now) : { checkedAt: now.toISOString(), checks: [{ key: "connection", status: "error", detail: info.message }], error: info.message };
    }
  },
  validateAndConnect: (channel, input, deps) => revalidateImap(channel, input, deps.mailConnectors),
  // Nothing held outside: disconnecting deletes the stored password.
  async disconnect() {},
};
