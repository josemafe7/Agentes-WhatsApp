// The IMAP and SMTP settings of an «Otro (IMAP/SMTP)» channel, from its config and its encrypted passwords, and the
// folders found by SPECIAL-USE (or by their usual names when the server has no SPECIAL-USE, [COR-13]).
import "server-only";
import type { ChannelRecord } from "../../types";
import { readEmailConfig, readMailPasswords } from "../config";
import { EmailReconnectError } from "../status";
import type { ImapListEntry, MailServerSettings } from "./connection";

export type ImapChannelSettings = { imap: MailServerSettings; smtp: MailServerSettings; address: string };

export const MISSING_PASSWORD_REASON = "Faltan la contraseña o los servidores del buzón. Vuelve a conectarlo.";

export function imapSettingsOf(channel: Pick<ChannelRecord, "config" | "secretsEnc">): ImapChannelSettings {
  const config = readEmailConfig(channel.config);
  const state = config.imap;
  const passwords = readMailPasswords(channel);
  const address = config.emailAddress;
  if (!passwords || !address || !state.imapHost || !state.imapPort || !state.imapSecurity || !state.smtpHost || !state.smtpPort || !state.smtpSecurity) {
    throw new EmailReconnectError(MISSING_PASSWORD_REASON);
  }
  const username = state.username || address;
  return {
    address,
    imap: { host: state.imapHost, port: state.imapPort, security: state.imapSecurity, username, password: passwords.password },
    smtp: { host: state.smtpHost, port: state.smtpPort, security: state.smtpSecurity, username: state.smtpUsername || username, password: passwords.smtpPassword ?? passwords.password },
  };
}

const SENT_NAMES = ["sent", "sent items", "sent messages", "enviados", "elementos enviados", "inbox.sent", "inbox.enviados", "[gmail]/sent mail", "[gmail]/enviados"];
const DRAFT_NAMES = ["drafts", "borradores", "inbox.drafts", "inbox.borradores", "[gmail]/drafts", "[gmail]/borradores"];

function byName(folders: readonly ImapListEntry[], names: readonly string[]): string | null {
  return folders.find((folder) => names.includes(folder.path.toLowerCase()))?.path ?? null;
}

/** Sent and Drafts by their function (\Sent, \Drafts), else by the usual names. */
export function specialFolders(folders: readonly ImapListEntry[]): { sentPath: string | null; draftsPath: string | null } {
  const bySpecialUse = (flag: string) => folders.find((folder) => folder.specialUse === flag || folder.flags.has(flag))?.path ?? null;
  return {
    sentPath: bySpecialUse("\\Sent") ?? byName(folders, SENT_NAMES),
    draftsPath: bySpecialUse("\\Drafts") ?? byName(folders, DRAFT_NAMES),
  };
}
