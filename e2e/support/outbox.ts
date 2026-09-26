// Reads the system emails the app saves as .eml in data/outbox when no SMTP is configured (demo and
// development, src/server/mailer.ts). The e2e demo server writes there too, so tests look only for their
// own recipient and for files written after they started.
import fs from "node:fs";
import path from "node:path";
import { expect } from "@playwright/test";

export const OUTBOX_DIR = path.resolve(__dirname, "..", "..", "data", "outbox");

export type OutboxEmail = {
  file: string;
  to: string;
  subject: string;
  /** Decoded text/plain part (or the whole decoded body when there is no text part). */
  text: string;
  links: string[];
};

type Part = { headers: Map<string, string>; body: string };

function splitPart(raw: string): Part {
  const match = /\r?\n\r?\n/.exec(raw);
  const head = match ? raw.slice(0, match.index) : raw;
  const body = match ? raw.slice(match.index + match[0].length) : "";
  const headers = new Map<string, string>();
  for (const line of head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon > 0) headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
  }
  return { headers, body };
}

function decodeQuotedPrintable(value: string): string {
  const latin1 = value.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  return Buffer.from(latin1, "latin1").toString("utf8");
}

function decodeBody(part: Part): string {
  const encoding = (part.headers.get("content-transfer-encoding") ?? "").toLowerCase();
  if (encoding === "quoted-printable") return decodeQuotedPrintable(part.body);
  if (encoding === "base64") return Buffer.from(part.body.replace(/\s+/g, ""), "base64").toString("utf8");
  return part.body;
}

/** RFC 2047 encoded words («=?UTF-8?Q?Invitaci=C3=B3n?=») in headers such as Subject. */
function decodeHeader(value: string): string {
  return value
    .replace(/(=\?[^?]+\?[QqBb]\?[^?]*\?=)\s+(?==\?)/g, "$1")
    .replace(/=\?([^?]+)\?([QqBb])\?([^?]*)\?=/g, (_, _charset: string, kind: string, text: string) =>
      kind.toUpperCase() === "B"
        ? Buffer.from(text, "base64").toString("utf8")
        : decodeQuotedPrintable(text.replace(/_/g, " ")),
    );
}

function textOf(message: Part): string {
  const type = message.headers.get("content-type") ?? "text/plain";
  const boundary = /boundary="?([^";]+)"?/i.exec(type)?.[1];
  if (!boundary) return decodeBody(message);
  const parts = message.body
    .split(`--${boundary}`)
    .slice(1)
    .filter((chunk) => !chunk.startsWith("--"))
    .map((chunk) => splitPart(chunk.replace(/^\r?\n/, "")));
  for (const part of parts) {
    const partType = part.headers.get("content-type") ?? "";
    if (partType.startsWith("multipart/")) return textOf(part);
    if (partType.startsWith("text/plain")) return decodeBody(part);
  }
  return parts.map(decodeBody).join("\n");
}

export function parseEml(file: string, raw: string): OutboxEmail {
  const message = splitPart(raw);
  const text = textOf(message);
  return {
    file,
    to: decodeHeader(message.headers.get("to") ?? ""),
    subject: decodeHeader(message.headers.get("subject") ?? ""),
    text,
    links: [...text.matchAll(/https?:\/\/[^\s<>"')]+/g)].map((found) => found[0]),
  };
}

/** The newest email to `to` written after `since`, or null. */
export function findEmail(to: string, since: number): OutboxEmail | null {
  if (!fs.existsSync(OUTBOX_DIR)) return null;
  const wanted = to.toLowerCase();
  const files = fs
    .readdirSync(OUTBOX_DIR)
    .filter((name) => name.endsWith(".eml"))
    .map((name) => ({ name, full: path.join(OUTBOX_DIR, name) }))
    .map((entry) => ({ ...entry, mtime: fs.statSync(entry.full).mtimeMs }))
    // A little slack: the file system clock and Date.now() are not always in step.
    .filter((entry) => entry.mtime >= since - 2_000)
    .sort((a, b) => b.mtime - a.mtime);
  for (const entry of files) {
    const raw = fs.readFileSync(entry.full, "utf8");
    // Skip a file the app is still writing: a multipart message is complete once its closing boundary is there.
    const boundary = /boundary="?([^";\r\n]+)"?/i.exec(raw)?.[1];
    if (boundary && !raw.includes(`--${boundary}--`)) continue;
    const email = parseEml(entry.name, raw);
    if (email.to.toLowerCase().includes(wanted)) return email;
  }
  return null;
}

/**
 * Waits for the newest email to `to` written after `since`. `onPoll` runs before each look, for example to
 * trigger the job queue when the email is sent in the background (password reset).
 */
export async function waitForEmail(options: {
  to: string;
  since: number;
  timeoutMs?: number;
  onPoll?: () => Promise<void>;
}): Promise<OutboxEmail> {
  const result: { email: OutboxEmail | null } = { email: null };
  await expect
    .poll(
      async () => {
        await options.onPoll?.();
        result.email = findEmail(options.to, options.since);
        return result.email !== null;
      },
      { message: `email to ${options.to} in ${OUTBOX_DIR}`, timeout: options.timeoutMs ?? 30_000, intervals: [500, 1_000, 2_000] },
    )
    .toBe(true);
  if (!result.email) throw new Error(`No email to ${options.to}`);
  return result.email;
}

/** The first link of the email on the app whose path starts with `pathPrefix`. */
export function linkIn(email: OutboxEmail, appUrl: string, pathPrefix: string): string {
  const link = email.links.find((candidate) => {
    const url = new URL(candidate);
    return url.origin === new URL(appUrl).origin && url.pathname.startsWith(pathPrefix);
  });
  if (!link) throw new Error(`No ${pathPrefix} link on ${appUrl} in «${email.subject}»: ${email.links.join(", ") || "no links"}`);
  return link;
}
