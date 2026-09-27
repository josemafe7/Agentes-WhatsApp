// Optional IMAP IDLE, only for the VPS worker (`pnpm worker` with EMAIL_IMAP_IDLE=true and the channel's `imap.idle`
// on): a connection stays open on INBOX and, when the server announces new mail, the channel's poll runs at once
// instead of waiting for the next one (docs/integracion-correo.md §3.2). On Vercel connections are short: there the
// poll alone does the work. ImapFlow does not reconnect by itself ([F71]): the watcher reconnects with growing waits.
import "server-only";
import { and, eq } from "drizzle-orm";
import { ImapFlow } from "imapflow";
import { db } from "@/db";
import { channels } from "@/db/schema";
import { safeErrorMessage } from "@/server/redact";
import type { ChannelRecord } from "../../types";
import { readEmailConfig } from "../config";
import { requestEmailPollSoon } from "../jobs";
import { mailConnectors, resolveMailHost, type ConnectTarget, type MailConnectors, type MailServerSettings } from "./connection";
import { imapSettingsOf } from "./settings";
import { INBOX } from "./sync";

export const IMAP_IDLE_ENV = "EMAIL_IMAP_IDLE";
const MAX_IDLE_MS = 5 * 60_000;
const MIN_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 5 * 60_000;

export function imapIdleEnabled(): boolean {
  return process.env[IMAP_IDLE_ENV]?.trim().toLowerCase() === "true";
}

/** What IDLE needs of ImapFlow (tests pass a fake that emits «exists»). */
export interface IdleClient {
  connect(): Promise<void>;
  getMailboxLock(path: string): Promise<{ release(): void }>;
  on(event: "exists" | "error" | "close", listener: () => void): unknown;
  logout(): Promise<void>;
  close(): void;
}
export type IdleClientFactory = (settings: MailServerSettings, target: ConnectTarget) => IdleClient;

const realIdleClient: IdleClientFactory = (settings, target) =>
  new ImapFlow({
    host: target.address,
    ...(target.servername ? { servername: target.servername } : {}),
    port: settings.port,
    secure: settings.security === "tls",
    ...(settings.security === "starttls" ? { doSTARTTLS: true } : {}),
    auth: { user: settings.username, pass: settings.password },
    logger: false,
    maxIdleTime: MAX_IDLE_MS,
  });

export type WatchOptions = { signal: AbortSignal; onNewMail?: (channelId: string) => Promise<void>; createClient?: IdleClientFactory; connectors?: MailConnectors };

/** One IDLE session on the channel's INBOX; resolves when the connection ends or `signal` aborts. */
export async function watchImapInbox(channel: ChannelRecord, options: WatchOptions): Promise<void> {
  const settings = imapSettingsOf(channel).imap;
  const target = await resolveMailHost(settings.host, settings.port, { resolveHost: mailConnectors(options.connectors).resolveHost });
  const client = (options.createClient ?? realIdleClient)(settings, target);
  const onNewMail = options.onNewMail ?? ((channelId: string) => requestEmailPollSoon(channelId));
  await new Promise<void>((resolve) => {
    const done = () => resolve();
    client.on("exists", () => {
      onNewMail(channel.id).catch((error: unknown) => console.warn(`[email] IDLE: ${safeErrorMessage(error)}`));
    });
    client.on("error", done);
    client.on("close", done);
    if (options.signal.aborted) return done();
    options.signal.addEventListener("abort", done, { once: true });
    client
      .connect()
      .then(() => client.getMailboxLock(INBOX))
      .catch(done);
  });
  try {
    await client.logout();
  } catch {
    client.close();
  }
}

/** The worker's loop: every IMAP channel with IDLE on keeps a session, reconnecting with growing waits. */
export async function runImapIdleWatchers(options: WatchOptions & { sleep?: (ms: number) => Promise<void> }): Promise<void> {
  if (!imapIdleEnabled()) return;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const rows = await db.select().from(channels).where(and(eq(channels.type, "email_imap"), eq(channels.status, "connected"), eq(channels.isDemo, false)));
  const watched = rows.filter((channel) => readEmailConfig(channel.config).imap.idle === true);
  await Promise.all(
    watched.map(async (channel) => {
      let backoff = MIN_BACKOFF_MS;
      while (!options.signal.aborted) {
        const started = Date.now();
        try {
          await watchImapInbox(channel, options);
        } catch (error) {
          console.warn(`[email] IDLE sin conexión: ${safeErrorMessage(error)}`);
        }
        backoff = Date.now() - started > MAX_IDLE_MS ? MIN_BACKOFF_MS : Math.min(backoff * 2, MAX_BACKOFF_MS);
        if (!options.signal.aborted) await sleep(backoff);
      }
    }),
  );
}
