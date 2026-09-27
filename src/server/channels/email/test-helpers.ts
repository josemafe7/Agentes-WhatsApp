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
