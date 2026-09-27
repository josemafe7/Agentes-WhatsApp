// «Pruebas de conexión» of Ajustes › Diagnóstico ([AJU-11]): owner and admin run, now, the checks the app already has —
// «Probar clave» of OpenRouter ([AJU-04]), «Enviar correo de prueba» of the system mail ([AJU-06]) and each connected
// channel's own check: «Revalidar» with Meta and every light for WhatsApp ([WA-27]), the access (token) of Gmail and
// Outlook ([CAN-15], [COR-22]) and «Probar conexión» (IMAP and SMTP) for another mailbox ([COR-11]). Results are in
// Spanish and never carry a key, a token or a password ([SEG-02]); a demo channel never reaches any service ([ARR-11]).
// They call outside services, so each person has a limit ([SEG-07]).
import "server-only";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { channels, type ChannelHealth } from "@/db/schema";
import type { ChannelStatus, ChannelType } from "@/lib/enums";
import { isMetaGraphError } from "@/lib/meta/errors";
import { checkOpenRouterKey } from "@/lib/openrouter/key";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { getRateLimiter } from "@/server/adapters/rate-limiter";
import { readEmailConfig } from "@/server/channels/email/config";
import { WHATSAPP_HEALTH_LABELS } from "@/server/channels/whatsapp/health";
import { runHealthCheck } from "@/server/channels/whatsapp/jobs";
import type { ChannelRecord } from "@/server/channels/types";
import { AppError, AuthError, NotFoundError, parseInput, RateLimitError } from "@/server/errors";
import { isOutboxAllowed } from "@/server/mailer";
import { checkEmailChannel } from "./email";
import { testEmailServers } from "./email-connect";
import { assertCan } from "./guard";
import { getSmtpConfig, isAiConfigured, loadBusinessSettings, resolveOpenRouterKey } from "./settings";
import { sendTestEmail } from "./system-mail";
import { revalidateWhatsAppChannel } from "./whatsapp";

/** Channels that talk to an outside service (the web chat has nothing to test; Telegram is not built yet). */
export const TESTABLE_CHANNEL_TYPES = ["whatsapp", "email_gmail", "email_outlook", "email_imap"] as const satisfies readonly ChannelType[];
export type TestableChannelType = (typeof TESTABLE_CHANNEL_TYPES)[number];

/** Each person, this many tests every 10 minutes: they call Meta, Google, Microsoft, OpenRouter and mail servers. */
export const CONNECTION_TESTS_LIMIT = { limit: 20, windowMs: 10 * 60_000 };
const RATE_LIMITED = "Has hecho muchas pruebas de conexión seguidas. Espera unos minutos.";
const CHANNEL_NOT_FOUND = "No se ha encontrado el canal.";

/** The Spanish names of the lights of a mailbox (src/server/channels/email/*), as its panel shows them. */
const EMAIL_HEALTH_LABELS: Record<string, string> = {
  connection: "Conexión",
  permissions: "Permisos",
  last_read: "Última lectura",
  folders: "Carpetas",
  secret_expiry: "Caducidad del Client Secret",
  access_expiry: "Caducidad del acceso",
};
const WHATSAPP_LABELS: Record<string, string> = WHATSAPP_HEALTH_LABELS;

export type ConnectionTestChannel = { id: string; name: string; type: TestableChannelType; status: ChannelStatus; isDemo: boolean };

export type ConnectionTests = {
  openRouter: { configured: boolean };
  /** Without SMTP, in development or the demo the test email is kept in the local outbox. */
  systemMail: { configured: boolean; outbox: boolean };
  channels: ConnectionTestChannel[];
};

export const connectionTestInputSchema = z.discriminatedUnion("target", [
  z.object({ target: z.literal("openrouter") }).strict(),
  z.object({ target: z.literal("system_mail") }).strict(),
  z.object({ target: z.literal("channel"), channelId: idSchema }).strict(),
]);
export type ConnectionTestInput = z.infer<typeof connectionTestInputSchema>;

/** One line of a result: a light of the channel, a detail of the key… `info` is only information. */
export type ConnectionCheck = { status: "ok" | "warn" | "error" | "info"; text: string };
export type ConnectionTestResult = { ok: boolean; summary: string; checks: ConnectionCheck[] };

function isTestable(type: ChannelType): type is TestableChannelType {
  return (TESTABLE_CHANNEL_TYPES as readonly string[]).includes(type);
}

/** What can be tested now (owner and admin). Nothing is called here. */
export async function listConnectionTests(actor: Actor): Promise<ConnectionTests> {
  assertCan(actor, PERMISSIONS.settings.diagnostics);
  const [configured, smtp, rows] = await Promise.all([
    isAiConfigured(),
    getSmtpConfig(),
    db
      .select({ id: channels.id, name: channels.name, type: channels.type, status: channels.status, isDemo: channels.isDemo })
      .from(channels)
      .where(and(inArray(channels.type, [...TESTABLE_CHANNEL_TYPES]), ne(channels.status, "draft")))
      .orderBy(asc(channels.name)),
  ]);
  const testable = rows.flatMap((row) => (isTestable(row.type) ? [{ ...row, type: row.type }] : []));
  return { openRouter: { configured }, systemMail: { configured: smtp !== null, outbox: isOutboxAllowed() }, channels: testable };
}

/** Runs one test now and says how it went, in Spanish (owner and admin). */
export async function runConnectionTest(actor: Actor, input: unknown): Promise<ConnectionTestResult> {
  assertCan(actor, PERMISSIONS.settings.diagnostics);
  const test = parseInput(connectionTestInputSchema, input);
  const limit = await getRateLimiter().hit(`diagnostics:connection-test:${actor.userId}`, CONNECTION_TESTS_LIMIT.limit, CONNECTION_TESTS_LIMIT.windowMs);
  if (!limit.allowed) throw new RateLimitError(RATE_LIMITED);
  if (test.target === "openrouter") return testOpenRouter();
  if (test.target === "system_mail") return testSystemMail(actor);
  return testChannel(actor, test.channelId);
}

// ─── OpenRouter and the system mail ─────────────────────────────────────────────────────────────────────

async function testOpenRouter(): Promise<ConnectionTestResult> {
  const resolved = await resolveOpenRouterKey();
  if (!resolved) return { ok: false, summary: "Todavía no hay clave de OpenRouter: ponla en Ajustes › IA.", checks: [] };
  const { timezone } = await loadBusinessSettings();
  const check = await checkOpenRouterKey(resolved.key, { timeZone: timezone });
  if (!check.valid) return { ok: false, summary: check.message, checks: [] };
  const where = resolved.source === "settings" ? "La clave es la de Ajustes › IA." : "La clave es la de OPENROUTER_API_KEY (no hay ninguna en Ajustes › IA).";
  return {
    ok: true,
    summary: check.summary,
    checks: [...check.details.map((text): ConnectionCheck => ({ status: "info", text })), { status: "info", text: where }, ...check.warnings.map((text): ConnectionCheck => ({ status: "warn", text }))],
  };
}

async function testSystemMail(actor: Actor): Promise<ConnectionTestResult> {
  const result = await sendTestEmail(actor);
  if (!result.sent) return { ok: false, summary: result.message, checks: [] };
  if (result.via === "smtp") return { ok: true, summary: `Correo de prueba enviado a ${result.to}. Mira tu bandeja de entrada.`, checks: [] };
  return {
    ok: true,
    summary: "Sin servidor de correo configurado: el correo de prueba se ha guardado en la bandeja local («Correos del sistema», en esta página).",
    checks: [{ status: "warn", text: "Hasta que configures Ajustes › Correo del sistema, los correos de la app no salen de este ordenador." }],
  };
}

// ─── Channels ───────────────────────────────────────────────────────────────────────────────────────────

async function testChannel(actor: Actor, channelId: string): Promise<ConnectionTestResult> {
  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId));
  if (!channel || !isTestable(channel.type) || channel.status === "draft") throw new NotFoundError(CHANNEL_NOT_FOUND);
  if (channel.isDemo) return { ok: true, summary: "Canal de demostración: no se conecta a ningún servicio.", checks: [] };
  try {
    if (channel.type === "whatsapp") return await testWhatsApp(actor, channel.id);
    if (channel.type === "email_imap") return await testImap(actor, channel);
    const provider = channel.type === "email_gmail" ? "Google" : "Microsoft";
    return healthResult(await checkEmailChannel(actor, { channelId: channel.id }), EMAIL_HEALTH_LABELS, `${provider} acepta el acceso al buzón: los semáforos están al día.`);
  } catch (error) {
    if (isMetaGraphError(error)) return { ok: false, summary: `${error.userMessage} ${error.action}`, checks: [] };
    // No permission or too many attempts is the action's answer; any other expected failure is this test's result.
    if (error instanceof AuthError || error instanceof RateLimitError || !(error instanceof AppError)) throw error;
    const detail = Object.values(error.fieldErrors ?? {}).flat()[0];
    return { ok: false, summary: detail ?? error.userMessage, checks: [] };
  }
}

/** A channel's lights as lines: «Token: válido…». `ok` unless something is red. */
function healthResult(health: ChannelHealth, labels: Record<string, string>, okSummary: string): ConnectionTestResult {
  const checks = health.checks.map((check): ConnectionCheck => {
    const label = labels[check.key] ?? "Comprobación";
    return { status: check.status === "off" ? "info" : check.status, text: check.detail ? `${label}: ${check.detail}` : label };
  });
  const failed = health.error ?? (checks.some((check) => check.status === "error") ? "Hay algo que arreglar: mira los puntos marcados como error." : null);
  return failed ? { ok: false, summary: failed, checks } : { ok: true, summary: okSummary, checks };
}

/** «Revalidar» of the WhatsApp panel ([WA-27]): the stored credentials with Meta, then every light, stored in the channel. */
async function testWhatsApp(actor: Actor, channelId: string): Promise<ConnectionTestResult> {
  const view = await revalidateWhatsAppChannel(actor, channelId);
  if (!view.ok) return { ok: false, summary: view.error, checks: [] };
  const warnings = view.warnings.map((text): ConnectionCheck => ({ status: "warn", text }));
  const report = await runHealthCheck(channelId);
  if (!report) return { ok: true, summary: "Meta ha validado las credenciales del número.", checks: warnings };
  const result = healthResult(report.health, WHATSAPP_LABELS, "Meta ha validado el número: los semáforos están al día.");
  return { ...result, checks: [...warnings, ...result.checks] };
}

/** The stored servers of an IMAP/SMTP mailbox, as «Probar conexión» takes them; null if any is missing. */
function storedMailServers(channel: ChannelRecord) {
  const config = readEmailConfig(channel.config);
  const { imap } = config;
  if (!config.emailAddress || !imap.imapHost || !imap.imapPort || !imap.imapSecurity || !imap.smtpHost || !imap.smtpPort || !imap.smtpSecurity) return null;
  return {
    email: config.emailAddress,
    ...(imap.username ? { username: imap.username } : {}),
    ...(imap.smtpUsername ? { smtpUsername: imap.smtpUsername } : {}),
    imap: { host: imap.imapHost, port: imap.imapPort, security: imap.imapSecurity },
    smtp: { host: imap.smtpHost, port: imap.smtpPort, security: imap.smtpSecurity },
  };
}

/** «Probar conexión» of the mailbox ([COR-11]): IMAP and SMTP with the stored servers and password. Nothing is stored. */
async function testImap(actor: Actor, channel: ChannelRecord): Promise<ConnectionTestResult> {
  const servers = storedMailServers(channel);
  if (!servers) return { ok: false, summary: "Faltan los datos del servidor de este buzón: vuelve a conectarlo desde su panel.", checks: [] };
  const result = await testEmailServers(actor, { channelId: channel.id, ...servers });
  if (result.ok) {
    return {
      ok: true,
      summary: "La entrada (IMAP) y el envío (SMTP) funcionan.",
      checks: [
        { status: "ok", text: "Entrada (IMAP): conectado." },
        { status: "ok", text: "Envío (SMTP): conectado." },
      ],
    };
  }
  return {
    ok: false,
    summary: result.wrongPassword ? "El servidor no acepta el usuario o la contraseña: reconecta el buzón con la nueva." : "No se ha podido conectar con el servidor de correo.",
    checks: [
      result.imap ? { status: "error", text: `Entrada (IMAP): ${result.imap}` } : { status: "ok", text: "Entrada (IMAP): conectado." },
      result.smtp ? { status: "error", text: `Envío (SMTP): ${result.smtp}` } : { status: "ok", text: "Envío (SMTP): conectado." },
    ],
  };
}
