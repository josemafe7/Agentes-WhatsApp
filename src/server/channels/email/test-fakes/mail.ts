// Fake IMAP and SMTP servers for the email tests: the connection is replaced, as docs/testing.md says.
import "server-only";
import type { ImapClientLike, ImapFetched, ImapListEntry, ImapSearch, MailConnectors, SmtpTransportLike } from "../imap/connection";
import { parseRawEmail } from "../parse";

export type FakeFolder = { path: string; specialUse?: string; uidValidity: bigint; uidNext: number; messages: { uid: number; source: Buffer; flags: Set<string> }[]; permanentFlags?: Set<string> };

export function fakeMailServers(options: { resolve?: (host: string) => string[]; sentSpecialUse?: boolean } = {}) {
  const folders = new Map<string, FakeFolder>();
  const addFolder = (path: string, specialUse?: string) => folders.set(path, { path, specialUse, uidValidity: BigInt(1), uidNext: 1, messages: [] });
  addFolder("INBOX");
  addFolder("Enviados", options.sentSpecialUse === false ? undefined : "\\Sent");
  addFolder("Borradores", "\\Drafts");
  const state = {
    folders,
    smtpSent: [] as { envelope: { from: string; to: string[] }; raw: Buffer }[],
    appended: [] as { path: string; flags: string[] }[],
    flagged: [] as { path: string; range: string; flags: string[] }[],
    deletedUids: [] as { path: string; range: string }[],
    imapAuthFails: false,
    smtpAuthFails: false,
    logins: [] as { host: string; servername: string | null; user: string }[],
  };

  function deliver(path: string, source: Buffer): number {
    const folder = folders.get(path);
    if (!folder) throw new Error(`No folder ${path}`);
    const uid = folder.uidNext;
    folder.uidNext += 1;
    folder.messages.push({ uid, source, flags: new Set() });
    return uid;
  }

  async function messageIdOf(source: Buffer): Promise<string | null> {
    return (await parseRawEmail(source)).messageId;
  }

  function createImap(settings: { username: string }, target: { address: string; servername: string | null }): ImapClientLike {
    let selected: FakeFolder | null = null;
    return {
      get mailbox() {
        return selected ? { path: selected.path, uidValidity: selected.uidValidity, uidNext: selected.uidNext, permanentFlags: selected.permanentFlags ?? new Set(["\\*", "\\Seen"]) } : false;
      },
      async connect() {
        state.logins.push({ host: target.address, servername: target.servername, user: settings.username });
        if (state.imapAuthFails) throw Object.assign(new Error("Authentication failed"), { authenticationFailed: true });
      },
      async logout() {},
      close() {},
      on() {
        return undefined;
      },
      async list(): Promise<ImapListEntry[]> {
        return [...folders.values()].map((folder) => ({ path: folder.path, specialUse: folder.specialUse, flags: new Set<string>() }));
      },
      async getMailboxLock(path: string) {
        selected = folders.get(path) ?? null;
        if (!selected) throw new Error("No such mailbox");
        return { release: () => undefined };
      },
      async *fetch(range: string): AsyncIterable<ImapFetched> {
        const from = Number(range.split(":")[0]);
        const list = selected?.messages ?? [];
        const matching = list.filter((message) => message.uid >= from);
        // «N:*» always returns the last message (RFC 9051).
        const result = matching.length > 0 ? matching : list.slice(-1);
        for (const message of result) yield { uid: message.uid };
      },
      async fetchOne(uid: string, query: { source?: boolean; headers?: boolean; size?: boolean }) {
        const message = selected?.messages.find((item) => item.uid === Number(uid));
        if (!message) return false;
        const end = message.source.indexOf("\r\n\r\n");
        return {
          uid: message.uid,
          ...(query.source ? { source: message.source } : {}),
          ...(query.headers ? { headers: message.source.subarray(0, end + 4) } : {}),
          ...(query.size ? { size: message.source.byteLength } : {}),
          internalDate: new Date("2026-09-27T09:00:00Z"),
        };
      },
      async search(query: ImapSearch) {
        const list = selected?.messages ?? [];
        if (query.header?.["message-id"]) {
          const wanted = String(query.header["message-id"]);
          const found: number[] = [];
          for (const message of list) if ((await messageIdOf(message.source)) === wanted) found.push(message.uid);
          return found;
        }
        return list.map((message) => message.uid);
      },
      async append(path: string, content: Buffer, flags: string[] = []) {
        state.appended.push({ path, flags });
        return { uid: deliver(path, content) };
      },
      async messageFlagsAdd(range: string, flags: string[]) {
        state.flagged.push({ path: selected?.path ?? "", range, flags });
        return true;
      },
      async messageDelete(range: string) {
        state.deletedUids.push({ path: selected?.path ?? "", range });
        if (selected) {
          const uids = new Set(range.split(",").map(Number));
          selected.messages = selected.messages.filter((message) => !uids.has(message.uid));
        }
        return true;
      },
    };
  }

  function createSmtp(): SmtpTransportLike {
    return {
      async verify() {
        if (state.smtpAuthFails) throw Object.assign(new Error("Invalid login"), { code: "EAUTH", responseCode: 535 });
        return true;
      },
      async sendMail(mail) {
        if (state.smtpAuthFails) throw Object.assign(new Error("Invalid login"), { code: "EAUTH", responseCode: 535 });
        state.smtpSent.push(mail);
        return { accepted: mail.envelope.to, rejected: [] };
      },
      close() {},
    };
  }

  const connectors: MailConnectors = {
    createImap,
    createSmtp,
    resolveHost: async (host) => (options.resolve?.(host) ?? ["93.184.216.34"]).map((address) => ({ address, family: address.includes(":") ? 6 : 4 })),
  };
  return { state, folders, deliver, connectors };
}
