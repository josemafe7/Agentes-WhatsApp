// Test doubles of the email world (docs/testing.md: tests never call real services): raw emails built with
// MailComposer, a fake Gmail API + Google OAuth, a fake Microsoft Graph + login, and fake IMAP/SMTP connectors. Only
// tests import this file.
import "server-only";
import MailComposer from "nodemailer/lib/mail-composer";

export { fakeGoogle, GMAIL_BASE, GOOGLE_OAUTH_BASE, idToken, type FakeGmailMessage } from "./test-fakes/google";
export { fakeMailServers, type FakeFolder } from "./test-fakes/mail";
export { fakeMicrosoft, GRAPH_BASE, MS_LOGIN_BASE, type FakeGraphMessage } from "./test-fakes/microsoft";
export type { RecordedCall } from "./test-fakes/http";

// ─── Raw emails ─────────────────────────────────────────────────────────────────────────────────────────

export type RawEmailInput = {
  from?: string;
  fromName?: string;
  to?: string;
  subject?: string;
  text?: string;
  html?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
  replyTo?: string;
  headers?: Record<string, string>;
  attachments?: { filename: string; contentType: string; content: Buffer | string; cid?: string }[];
  date?: Date;
};

/**
 * What the receiving server does ([COR-25]): its Authentication-Results goes on top of the message, above everything the
 * sender wrote. `results` is the value, e.g. «mx.google.com; dmarc=pass header.from=cliente.test».
 */
export function receivedWith(raw: Buffer, results: string): Buffer {
  return Buffer.concat([Buffer.from(`Authentication-Results: ${results}\r\n`), raw]);
}

/** A customer email that passed DMARC at the receiving server (the From of buildRawEmail's default, or `from`). */
export async function verifiedEmail(input: RawEmailInput = {}): Promise<Buffer> {
  const domain = (input.from ?? "ana@cliente.test").split("@")[1];
  return receivedWith(await buildRawEmail(input), `mx.google.com; dkim=pass header.i=@${domain}; spf=pass smtp.mailfrom=${input.from ?? "ana@cliente.test"}; dmarc=pass (p=NONE) header.from=${domain}`);
}

export async function buildRawEmail(input: RawEmailInput = {}): Promise<Buffer> {
  const composer = new MailComposer({
    from: { name: input.fromName ?? "Ana Cliente", address: input.from ?? "ana@cliente.test" },
    to: input.to ?? "hola@negocio.test",
    subject: input.subject ?? "Consulta",
    messageId: input.messageId ?? `<${crypto.randomUUID()}@cliente.test>`,
    ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}),
    ...(input.references ? { references: input.references } : {}),
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    date: input.date ?? new Date("2026-09-27T09:00:00Z"),
    ...(input.text !== undefined || input.html === undefined ? { text: input.text ?? "Hola, ¿tenéis cita el martes?" } : {}),
    ...(input.html ? { html: input.html } : {}),
    headers: input.headers ?? {},
    attachments: (input.attachments ?? []).map((file) => ({ filename: file.filename, contentType: file.contentType, content: file.content, ...(file.cid ? { cid: file.cid } : {}) })),
  });
  return composer.compile().build();
}
