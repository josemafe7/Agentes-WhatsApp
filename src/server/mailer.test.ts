import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SendMailOptions } from "nodemailer";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { systemEmails } from "@/db/schema";
import { primaryCssVars } from "@/lib/color";
import { invitationEmail, passwordResetEmail, testEmail } from "./email-templates";
import { NOT_CONFIGURED_MESSAGE, sendSystemEmail, SYSTEM_EMAIL_HEADER } from "./mailer";

const outboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "dominia-outbox-"));
afterAll(() => fs.rmSync(outboxDir, { recursive: true, force: true }));
afterEach(() => vi.unstubAllEnvs());

const smtp = { host: "smtp.example.com", port: 587, security: "starttls" as const, user: "app", fromEmail: "hola@peluqueria.test", fromName: "Peluquería", password: "secreto" };
const email = { kind: "test" as const, to: "Ana@Example.com", subject: "Prueba\r\nBcc: evil@x.com", text: "Hola" };

describe("sendSystemEmail [AJU-06] [USU-06]", () => {
  it("sends through SMTP with the system header and without file or URL access", async () => {
    const sent: SendMailOptions[] = [];
    const result = await sendSystemEmail(email, {
      smtp,
      createTransport: () => ({ sendMail: async (options) => void sent.push(options) }),
    });
    expect(result).toMatchObject({ ok: true, via: "smtp" });
    expect(sent[0]).toMatchObject({
      to: "ana@example.com",
      subject: "Prueba Bcc: evil@x.com",
      disableFileAccess: true,
      disableUrlAccess: true,
      headers: { [SYSTEM_EMAIL_HEADER]: "test" },
      from: { name: "Peluquería", address: "hola@peluqueria.test" },
    });
    const [row] = await db.select().from(systemEmails);
    expect(row).toMatchObject({ status: "sent", transport: "smtp", toEmail: "ana@example.com" });
  });

  it("reports a generic failure and logs it without secrets when SMTP fails", async () => {
    const result = await sendSystemEmail(email, {
      smtp,
      createTransport: () => ({
        sendMail: async () => {
          throw new Error("535 auth failed for password=secreto");
        },
      }),
    });
    expect(result).toMatchObject({ ok: false, reason: "send_failed" });
    const rows = await db.select().from(systemEmails);
    const failed = rows.find((r) => r.id === (result.ok ? "" : result.logId));
    expect(failed?.status).toBe("failed");
    expect(failed?.error).not.toContain("secreto");
  });

  it("without SMTP, in development, saves a .eml in the outbox", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const result = await sendSystemEmail({ ...email, html: "<p>Hola</p>" }, { smtp: null, outboxDir });
    expect(result).toMatchObject({ ok: true, via: "outbox" });
    if (!result.ok || result.via !== "outbox") throw new Error("expected outbox");
    const raw = fs.readFileSync(path.join(outboxDir, result.file), "utf8");
    expect(raw).toContain("To: ana@example.com");
    // Header names are case-insensitive; Nodemailer writes them as X-Dominia-System.
    expect(raw.toLowerCase()).toContain(`${SYSTEM_EMAIL_HEADER.toLowerCase()}: test`);
  });

  it("without SMTP in production (no demo) fails with a clear error", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_MODE", "false");
    const result = await sendSystemEmail(email, { smtp: null, outboxDir });
    expect(result).toMatchObject({ ok: false, reason: "not_configured", message: NOT_CONFIGURED_MESSAGE });
  });

  it("the demo keeps using the outbox even in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_MODE", "true");
    expect(await sendSystemEmail(email, { smtp: null, outboxDir })).toMatchObject({ ok: true, via: "outbox" });
  });
});

const BRAND = { name: "Pelu", color: "#3d6df2", logoUrl: null };

describe("email templates", () => {
  it("invitation: role, link, expiry and escaped business name", () => {
    const content = invitationEmail({
      brand: { ...BRAND, name: "Pelu <b>Ana</b>" },
      inviterName: "Marta",
      role: "agent",
      link: "https://app.test/invitacion/abc",
      expiresAt: new Date("2026-10-03T10:00:00Z"),
    });
    expect(content.subject).toBe("Invitación al equipo de Pelu <b>Ana</b>");
    expect(content.text).toContain("Marta te ha invitado");
    expect(content.text).toContain("rol Agente");
    expect(content.text).toContain("https://app.test/invitacion/abc");
    expect(content.html).toContain("Pelu &lt;b&gt;Ana&lt;/b&gt;");
    expect(content.html).not.toContain("<b>Ana</b>");
  });

  it("password reset: greeting, link and one-hour expiry", () => {
    const content = passwordResetEmail({ brand: BRAND, name: "Ana", link: "https://app.test/r?token=x" });
    expect(content.text).toContain("Hola, Ana:");
    expect(content.text).toContain("caduca en 1 hora");
    expect(content.html).toContain("https://app.test/r?token=x");
  });

  it("[AJU-01] every system email shows the business name, logo and colour", () => {
    const brand = { name: "Clínica Sonrisa", color: "#e11d48", logoUrl: "https://app.test/api/files/logos/2026/09/logo.png" };
    const { light } = primaryCssVars(brand.color);
    const emails = [
      invitationEmail({ brand, inviterName: null, role: "viewer", link: "https://app.test/invitacion/abc", expiresAt: new Date("2026-10-03T10:00:00Z") }),
      passwordResetEmail({ brand, name: null, link: "https://app.test/r?token=x" }),
      testEmail({ brand, name: "Ana" }),
    ];
    for (const content of emails) {
      expect(content.html).toContain("Clínica Sonrisa");
      expect(content.html).toContain(`<img src="${brand.logoUrl}"`);
      expect(content.html.toLowerCase()).not.toContain("#3d6df2");
      expect(content.text).toContain("Clínica Sonrisa");
    }
    // The button: the business colour as the panel shows it on white, with its readable text colour.
    expect(emails[0].html).toContain(`background:${light["--primary"]};color:${light["--primary-foreground"]}`);
  });

  it("[AJU-01] without a logo there is no image, and a broken colour falls back to the default blue", () => {
    const content = passwordResetEmail({ brand: { name: "Pelu", color: "no-es-color", logoUrl: null }, name: null, link: "https://app.test/r" });
    expect(content.html).not.toContain("<img");
    expect(content.html).toContain(`background:${primaryCssVars("#3d6df2").light["--primary"]}`);
  });

  it("[AJU-01] the logo address is escaped like everything else", () => {
    const content = testEmail({ brand: { name: "Pelu", color: "#3d6df2", logoUrl: 'https://app.test/a"onerror="x' }, name: "Ana" });
    expect(content.html).not.toContain('"onerror="');
    expect(content.html).toContain("&quot;onerror=&quot;");
  });
});
