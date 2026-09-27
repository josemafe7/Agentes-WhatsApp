// The email guide in Ayuda ([ARR-23], [AJU-17], [COR-01]–[COR-24]) and the conectar-correo skill that follows it
// ([ARR-24]). The guide quotes the Spanish messages the app shows, so a change in one of them shows up here.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CAP_REASON_SENDER, CAP_REASON_THREAD } from "@/server/channels/email/caps";
import { MAIL_PASSWORD_REASON } from "@/server/channels/email/errors";
import { IGNORE_REASON_LABELS } from "@/server/channels/email/filters";
import { MICROSOFT_REDIRECT_MESSAGE } from "@/server/channels/email/imap/connect";
import { MailHostError } from "@/server/channels/email/imap/connection";
import { describeMailError } from "@/server/channels/email/imap/errors";
import { MAIL_PRESETS } from "@/server/channels/email/imap/presets";
import { MAILBOX_PAUSE_REASON } from "@/server/channels/email/ingest";
import { OAUTH_FAILURE_MESSAGES } from "@/server/channels/email/oauth-results";
import { AI_NOTICE_AUTOMATIC, AI_NOTICE_REVIEWED } from "@/server/channels/email/signature";
import { RECONNECT_REASONS } from "@/server/channels/email/tokens";
import { findGuide, parseGuide, readGuide } from "./guides";

/** The sections the «¿Dónde lo encuentro?» and «Ver la guía» of the email wizard open. */
const WIZARD_ANCHORS = [
  "gmail",
  "google-cloud",
  "pantalla-de-consentimiento",
  "credenciales",
  "produccion",
  "outlook",
  "entra",
  "permisos",
  "secreto",
  "consentimiento-admin",
  "imap",
  "contrasena-de-aplicacion",
  "problemas",
] as const;

const guide = findGuide("correo");
const guideText = async () => (guide ? readGuide(guide) : "");
const problemsOf = (text: string) => text.slice(text.indexOf("\n## Problemas"));

describe("the email guide [ARR-23] [AJU-17]", () => {
  it("is at /ayuda/correo, from docs/guia-correo.md, with a section for each «¿Dónde lo encuentro?» of the wizard", async () => {
    expect(guide?.file).toBe("guia-correo.md");
    const parsed = parseGuide(await guideText());
    expect(parsed.title).toBe("Conectar el correo");
    const ids = parsed.sections.map((section) => section.id);
    for (const anchor of WIZARD_ANCHORS) expect(ids, anchor).toContain(anchor);
    // The wizard's own list, so a new «¿Dónde lo encuentro?» never points to a missing section.
    const { GUIDE_ANCHORS } = await import("@/app/(app)/canales/nuevo/correo/_lib/help");
    for (const anchor of GUIDE_ANCHORS) expect(ids, anchor).toContain(anchor);
  });

  it("explains Gmail with the business's own Google Cloud project: API, consent screen, web client and production [COR-02]–[COR-04] [COR-24]", async () => {
    const text = await guideText();
    for (const topic of [
      // The business's own project, never shared, with the Gmail API on.
      "console.cloud.google.com", "proyecto", "Gmail API", "Enable", "nunca", "otro negocio",
      // Consent screen: Internal with Workspace, External in production with @gmail.com, never Testing.
      "Google Auth Platform", "Branding", "Audience", "Internal", "External", "Google Workspace", "@gmail.com",
      "Testing", "7 días", "Publish app", "In production", "Data Access", "gmail.modify", "Authorized domains",
      "/legal/privacidad", "/legal/terminos",
      // The unverified-app warning and the 100-user cap.
      "Google no ha verificado esta app", "Advanced", "(unsafe)", "100 usuarios",
      // The web client with our redirect URI; the secret is shown only once.
      "Clients", "Create client", "Web application", "Authorized redirect URIs", "/api/oauth/google/callback",
      "Client ID", "Client Secret", ".apps.googleusercontent.com", "solo lo enseña al crearlo",
      // The wizard.
      "Canales › Añadir canal › Correo", "Conectar con Google", "marca todas las casillas",
      "¿Prefieres contraseña de aplicación? Usa Otro",
    ]) {
      expect(text, topic).toContain(topic);
    }
  });

  it("explains Outlook with the business's own Microsoft Entra app: registration, redirect, permissions, secret, tenant and admin consent [COR-07] [COR-09] [COR-22]", async () => {
    const text = await guideText();
    for (const topic of [
      "entra.microsoft.com", "App registrations", "New registration", "Supported account types", "Single tenant only",
      "Any Entra ID Tenant + Personal Microsoft accounts", "Application (client) ID", "Directory (tenant) ID",
      "Authentication", "Web", "/api/oauth/microsoft/callback",
      // Delegated permissions.
      "API permissions", "Microsoft Graph", "Delegated permissions", "offline_access", "User.Read", "Mail.ReadWrite", "Mail.Send",
      // The Client Secret: value, expiry of 24 months at most, the notice 30 days before and what happens when it expires.
      "Certificates & secrets", "New client secret", "Value", "Secret ID", "24 meses", "12 meses", "30 días", "AADSTS7000222",
      // Tenant and admin consent.
      "Tenant ID", "`common`", "Grant admin consent", "AADSTS65001", "Conectar con Microsoft",
      // Microsoft mailboxes never go through IMAP.
      "Outlook / Microsoft 365", "Outlook.com", "Hotmail", "Microsoft 365",
    ]) {
      expect(text, topic).toContain(topic);
    }
  });

  it("gives the IMAP/SMTP data of every provider the wizard fills in, app passwords and «Probar conexión» [COR-09]–[COR-13]", async () => {
    const text = await guideText();
    for (const preset of Object.values(MAIL_PRESETS)) {
      expect(text, preset.name).toContain(`\`${preset.imap.host}\``);
      expect(text, preset.name).toContain(`\`${preset.smtp.host}\``);
    }
    for (const topic of [
      "Otro (IMAP/SMTP)", "993", "465", "587", "SSL/TLS", "STARTTLS", "puerto 25", "mail.tudominio.com", "Connect Devices",
      "Probar conexión", "Enviados", "IA-Respondido",
      "Contraseña de aplicación", "verificación en dos pasos", "myaccount.google.com/apppasswords", "account.apple.com",
      "Create app password", "14-03-2025",
    ]) {
      expect(text, topic).toContain(topic);
    }
  });

  it("explains reply modes, the mailbox drafts, the pause, the daily caps, the signature and what is ignored [COR-14]–[COR-21] [CAN-07] [BAN-09] [BAN-11]", async () => {
    const text = await guideText();
    for (const topic of [
      "Borrador para revisar", "Automático", "Aprobar", "Editar", "Descartar", "Borradores", "IA/Respondido",
      MAILBOX_PAUSE_REASON, "Pausa de la IA cuando responde una persona", CAP_REASON_THREAD, CAP_REASON_SENDER,
      AI_NOTICE_AUTOMATIC, AI_NOTICE_REVIEWED, "Diagnóstico", "Promociones", "Otros",
      // Only mail that arrives after connecting is answered; attachments.
      "después de conectar", "PDF", "transcrib",
    ]) {
      expect(text, topic).toContain(topic);
    }
    // Every reason Diagnóstico counts is explained with the same words.
    for (const label of Object.values(IGNORE_REASON_LABELS)) expect(text, label).toContain(label);
  });

  it("explains frequent problems with cause and fix, quoting the Spanish messages the app shows [COR-11] [COR-22] [COR-23]", async () => {
    const problems = problemsOf(await guideText());
    expect(problems.length).toBeGreaterThan(20);
    expect(problems.match(/Causa: /g)?.length ?? 0).toBeGreaterThanOrEqual(30);
    expect(problems.match(/Solución: /g)?.length ?? 0).toBeGreaterThanOrEqual(30);
    const messages = [
      ...Object.values(OAUTH_FAILURE_MESSAGES),
      ...Object.values(RECONNECT_REASONS),
      MAIL_PASSWORD_REASON,
      MICROSOFT_REDIRECT_MESSAGE,
      ...["EAUTH", "ENOTFOUND", "ECONNREFUSED", "ETIMEDOUT", "ERR_TLS_CERT_ALTNAME_INVALID"].map((code) => describeMailError({ code }).message),
      ...(["blocked", "port", "invalid"] as const).map((reason) => new MailHostError(reason).userMessage),
    ];
    for (const message of messages) expect(problems, message).toContain(message);
  });

  it("has room for screenshots and keeps out secrets and the installation's internals", async () => {
    const text = await guideText();
    expect(text.match(/\[Captura: /g)?.length ?? 0).toBeGreaterThanOrEqual(10);
    expect(text).not.toMatch(/\.env|APP_ENCRYPTION_KEY|CRON_SECRET|ALLOW_PRIVATE_MAIL_HOSTS/);
  });
});

describe("the conectar-correo skill [ARR-24]", () => {
  const root = process.cwd();
  const skillDir = path.join(root, ".agents", "skills", "conectar-correo");
  const read = (file: string) => fs.readFileSync(file, "utf8").replace(/\r\n?/g, "\n");
  const frontmatter = (source: string) => {
    const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(source);
    expect(match).not.toBeNull();
    const fields = Object.fromEntries(
      (match?.[1] ?? "").split("\n").map((line) => {
        const colon = line.indexOf(":");
        const value = line.slice(colon + 1).trim();
        return [line.slice(0, colon).trim(), value.startsWith('"') ? (JSON.parse(value) as string) : value];
      }),
    );
    return { fields, body: (match?.[2] ?? "").trim() };
  };

  it("has its name and description, and its Claude Code bridge only points to it", () => {
    const skill = frontmatter(read(path.join(skillDir, "SKILL.md")));
    const bridge = frontmatter(read(path.join(root, ".claude", "skills", "conectar-correo", "SKILL.md")));
    expect(skill.fields.name).toBe("conectar-correo");
    expect(skill.fields.description.length).toBeGreaterThan(80);
    for (const topic of ["Google Cloud", "Microsoft Entra", "IMAP"]) expect(skill.fields.description, topic).toContain(topic);
    expect(bridge.fields).toEqual(skill.fields);
    expect(bridge.body).toBe(
      "Lee `.agents/skills/conectar-correo/SKILL.md` y sigue sus instrucciones. Las rutas que aparezcan en él parten de esa carpeta.",
    );
  });

  it("follows the guide section by section, and every file it points to exists", () => {
    const { body } = frontmatter(read(path.join(skillDir, "SKILL.md")));
    expect(body).toContain("../../../docs/guia-correo.md");
    expect(body).toContain("../../../docs/integracion-correo.md");
    for (const anchor of WIZARD_ANCHORS) expect(body, anchor).toContain(`#${anchor}`);
    for (const [relative] of body.matchAll(/\.\.\/\.\.\/\.\.\/[\w./-]+\.md/g)) {
      expect(fs.existsSync(path.resolve(skillDir, relative)), relative).toBe(true);
    }
  });
});
