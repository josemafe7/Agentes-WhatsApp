// Connections to the business's own IMAP and SMTP servers (ImapFlow and Nodemailer, docs/integracion-correo.md §3.2
// and §3.3), with the SSRF guard of docs/security.md: the host must resolve only to public addresses (never private,
// loopback, link-local or cloud metadata) unless ALLOW_PRIVATE_MAIL_HOSTS=true (a self-hosted server next to the
// app). The checked address is the one used: we connect to that IP and keep the name for TLS (SNI and certificate),
// so DNS cannot switch to an internal address in between. Never port 25, never without TLS, never a password in
// clear text. Tests and the e2e mocks replace the connectors (the mail servers are simulated by replacing the
// connection, docs/testing.md).
import "server-only";
import dns from "node:dns";
import { isIP } from "node:net";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { AppError } from "@/server/errors";
import { isPublicAddress, type ResolveHost } from "@/server/web-fetch";
import type { MailSecurity } from "../config";

export const BLOCKED_PORTS: ReadonlySet<number> = new Set([25]);
const CONNECTION_TIMEOUT_MS = 15_000;
const GREETING_TIMEOUT_MS = 15_000;
const SOCKET_TIMEOUT_MS = 60_000;

export type MailServerSettings = { host: string; port: number; security: MailSecurity; username: string; password: string };

// ─── What we use of ImapFlow and Nodemailer (tests pass fakes with the same shape) ─────────────────────────

export type ImapMailbox = { path: string; uidValidity: bigint; uidNext: number; permanentFlags?: Set<string> };
export type ImapListEntry = { path: string; specialUse?: string; flags: Set<string> };
export type ImapFetched = { uid: number; size?: number; source?: Buffer; headers?: Buffer; internalDate?: Date | string; flags?: Set<string> };
export type ImapSearch = { uid?: string; since?: Date; header?: Record<string, string | boolean> };

export interface ImapClientLike {
  readonly mailbox: ImapMailbox | false;
  connect(): Promise<void>;
  logout(): Promise<void>;
  close(): void;
  on(event: "error", listener: (error: Error) => void): unknown;
  list(): Promise<ImapListEntry[]>;
  getMailboxLock(path: string): Promise<{ release(): void }>;
  fetch(range: string, query: { uid: true; size?: boolean; source?: boolean; internalDate?: boolean; flags?: boolean }, options: { uid: true }): AsyncIterable<ImapFetched>;
  fetchOne(uid: string, query: { uid: true; source?: boolean; headers?: boolean; internalDate?: boolean; size?: boolean }, options: { uid: true }): Promise<ImapFetched | false | undefined>;
  search(query: ImapSearch, options: { uid: true }): Promise<number[] | false | undefined>;
  append(path: string, content: Buffer, flags?: string[]): Promise<{ uid?: number } | false>;
  messageFlagsAdd(range: string, flags: string[], options: { uid: true }): Promise<boolean>;
  messageDelete(range: string, options: { uid: true }): Promise<boolean>;
}

export interface SmtpTransportLike {
  verify(): Promise<unknown>;
  sendMail(mail: { envelope: { from: string; to: string[] }; raw: Buffer }): Promise<{ accepted?: unknown[]; rejected?: unknown[] }>;
  close(): void;
}

export type MailConnectors = {
  createImap(settings: MailServerSettings, target: ConnectTarget): ImapClientLike;
  createSmtp(settings: MailServerSettings, target: ConnectTarget): SmtpTransportLike;
  resolveHost: ResolveHost;
};

// ─── Host safety ([SEG-05], docs/security.md «Si el servidor descarga una URL…») ─────────────────────────

export class MailHostError extends AppError {
  constructor(reason: "blocked" | "not_found" | "port" | "invalid") {
    const messages = {
      blocked: "Ese servidor está en una red privada. Usa la dirección pública de tu proveedor de correo.",
      not_found: "No se encuentra ese servidor. Revisa la dirección.",
      port: "Ese puerto no se puede usar. Usa el que indica tu proveedor (normalmente 993 para IMAP y 465 o 587 para SMTP; nunca el 25).",
      invalid: "Escribe solo el nombre del servidor, por ejemplo imap.tudominio.com.",
    } as const;
    super(400, `mail_host_${reason}`, messages[reason]);
  }
}

/** Where to connect: the checked IP, and the name for TLS. */
export type ConnectTarget = { address: string; servername: string | null };

const HOST_NAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;

export function allowPrivateMailHosts(): boolean {
  return process.env.ALLOW_PRIVATE_MAIL_HOSTS?.trim().toLowerCase() === "true";
}

const resolveWithDns: ResolveHost = (hostname) => dns.promises.lookup(hostname, { all: true, verbatim: true });

/**
 * Checks a mail server's host and port and returns where to connect. Private addresses only with
 * ALLOW_PRIVATE_MAIL_HOSTS=true (self-hosted installations).
 */
export async function resolveMailHost(host: string, port: number, options: { resolveHost?: ResolveHost; allowPrivate?: boolean } = {}): Promise<ConnectTarget> {
  const name = host.trim().toLowerCase().replace(/\.$/, "");
  if (!Number.isInteger(port) || port < 1 || port > 65_535 || BLOCKED_PORTS.has(port)) throw new MailHostError("port");
  const allowPrivate = options.allowPrivate ?? allowPrivateMailHosts();
  const literal = isIP(name.replace(/^\[|\]$/g, "")) ? name.replace(/^\[|\]$/g, "") : null;
  if (literal) {
    if (!allowPrivate && !isPublicAddress(literal)) throw new MailHostError("blocked");
    return { address: literal, servername: null };
  }
  if (!HOST_NAME.test(name)) throw new MailHostError("invalid");
  if (allowPrivate) return { address: name, servername: name };
  let addresses;
  try {
    addresses = await (options.resolveHost ?? resolveWithDns)(name);
  } catch {
    throw new MailHostError("not_found");
  }
  if (addresses.length === 0) throw new MailHostError("not_found");
  if (addresses.some((entry) => !isPublicAddress(entry.address))) throw new MailHostError("blocked");
  return { address: addresses[0].address, servername: name };
}

// ─── Real connectors ────────────────────────────────────────────────────────────────────────────────────

function createImapFlow(settings: MailServerSettings, target: ConnectTarget): ImapClientLike {
  return new ImapFlow({
    host: target.address,
    ...(target.servername ? { servername: target.servername } : {}),
    port: settings.port,
    secure: settings.security === "tls",
    // STARTTLS must succeed: the password never travels in clear text.
    ...(settings.security === "starttls" ? { doSTARTTLS: true } : {}),
    auth: { user: settings.username, pass: settings.password },
    // Nothing of the conversation (credentials included) reaches the logs.
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
  });
}

function createSmtpTransport(settings: MailServerSettings, target: ConnectTarget): SmtpTransportLike {
  return nodemailer.createTransport({
    host: target.address,
    port: settings.port,
    secure: settings.security === "tls",
    requireTLS: settings.security === "starttls",
    ...(target.servername ? { servername: target.servername, tls: { servername: target.servername } } : {}),
    auth: { user: settings.username, pass: settings.password },
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
    logger: false,
  });
}

export const realMailConnectors: MailConnectors = { createImap: createImapFlow, createSmtp: createSmtpTransport, resolveHost: resolveWithDns };

let connectorsOverride: MailConnectors | null = null;

/** Tests only: fake mail servers for code that does not take `connectors`. Null restores the real ones. */
export function setMailConnectorsForTests(connectors: MailConnectors | null): void {
  connectorsOverride = connectors;
}

export function mailConnectors(explicit?: MailConnectors): MailConnectors {
  return explicit ?? connectorsOverride ?? realMailConnectors;
}

/** An IMAP client already connected (the host checked first). The caller always calls logout() or close(). */
export async function openImap(settings: MailServerSettings, connectors?: MailConnectors): Promise<ImapClientLike> {
  const chosen = mailConnectors(connectors);
  const target = await resolveMailHost(settings.host, settings.port, { resolveHost: chosen.resolveHost });
  const client = chosen.createImap(settings, target);
  // ImapFlow emits «error» on socket problems: without a listener the process would crash ([F71]).
  client.on("error", () => undefined);
  await client.connect();
  return client;
}

export async function openSmtp(settings: MailServerSettings, connectors?: MailConnectors): Promise<SmtpTransportLike> {
  const chosen = mailConnectors(connectors);
  const target = await resolveMailHost(settings.host, settings.port, { resolveHost: chosen.resolveHost });
  return chosen.createSmtp(settings, target);
}

/** Closes without waiting: LOGOUT, and the socket if the server does not answer. Never throws. */
export async function closeImap(client: ImapClientLike): Promise<void> {
  try {
    await client.logout();
  } catch {
    client.close();
  }
}
