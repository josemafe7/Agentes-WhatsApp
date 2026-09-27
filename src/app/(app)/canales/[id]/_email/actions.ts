"use server";
// Server Actions of the email panel ([CAN-07], [CAN-15], [CAN-16], [COR-07], [COR-11], [COR-17], [COR-21]–[COR-23]).
// Thin: session and «Canales: … configurar, conectar, desconectar» here (owner and admin, [PER-04]), then src/data,
// which checks it again and validates every field ([SEG-04], [SEG-05]). Secrets only travel inward: no result carries
// them, and the stored servers and passwords never go to the browser ([SEG-01], [SEG-02]).
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getChannel, updateChannel } from "@/data/channels";
import { checkEmailChannel, disconnectEmailChannel, emailSettingsSchema, getEmailChannelView, pollEmailChannelNow, updateEmailSettings, type EmailChannelView } from "@/data/email";
import { connectImapChannel, outlookAdminConsentUrl, saveGmailCredentials, saveOutlookCredentials, startGmailOAuth, startOutlookOAuth, testEmailServers } from "@/data/email-connect";
import { fail, fromZodError, ok, type ActionResult } from "@/lib/action-result";
import { REPLY_MODES } from "@/lib/enums";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";

const NOT_FOUND = "No se ha encontrado el canal.";
const WIZARD_NEEDED = "A este buzón le faltan datos de la conexión: termínala en el asistente de correo.";
const blankToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);

/** The list, the panel and its tabs show what changed. */
function revalidateChannels(): void {
  revalidatePath("/canales", "layout");
}

// ─── Reply mode, caps and signature ([CAN-07], [COR-17], [COR-21]) ─────────────────────────────────────

/** `imapIdle` («Leer al momento») only means something for IMAP mailboxes: the data layer ignores it for the rest. */
const panelSettingsSchema = emailSettingsSchema
  .pick({ dailyCapPerThread: true, dailyCapPerSender: true, signature: true, imapIdle: true })
  .extend({ replyMode: z.enum(REPLY_MODES, { error: "Elige cómo responde la IA." }) })
  .strict();

/** Checked whole before saving anything, so a wrong cap never leaves the reply mode changed alone. */
export async function saveEmailPanelSettingsAction(channelId: unknown, input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    const parsed = panelSettingsSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const { replyMode, ...settings } = parsed.data;
    // Refuses a channel that is not a mailbox before anything changes.
    await updateEmailSettings(actor, { channelId: id.data, ...settings });
    await updateChannel(actor, id.data, { replyMode });
    revalidateChannels();
    return ok(undefined, "Cambios guardados.");
  } catch (error) {
    return toActionFailure(error);
  }
}

// ─── Revalidar and Leer ahora ([CAN-15]) ────────────────────────────────────────────────────────────────

/** «Revalidar»: the provider checked now, and every light refreshed with the result. */
export async function revalidateEmailAction(channelId: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    const health = await checkEmailChannel(actor, { channelId: id.data });
    revalidateChannels();
    return health.error ? fail(health.error) : ok(undefined, "Buzón revisado: los semáforos están al día.");
  } catch (error) {
    return toActionFailure(error);
  }
}

/** «Leer ahora»: a read in the next round of the background work instead of waiting for the minute. */
export async function pollEmailNowAction(channelId: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    await pollEmailChannelNow(actor, { channelId: id.data });
    return ok(undefined, "El buzón se leerá en unos segundos: los correos nuevos aparecerán en la bandeja.");
  } catch (error) {
    return toActionFailure(error);
  }
}

// ─── Probar conexión (IMAP/SMTP) ([COR-11]) ─────────────────────────────────────────────────────────────

/** The stored servers of an IMAP mailbox as «Probar conexión» and «Conectar» take them; null if any is missing. */
function storedServers(view: EmailChannelView) {
  const imap = view.imap;
  if (!view.emailAddress || !imap?.imapHost || !imap.imapPort || !imap.imapSecurity || !imap.smtpHost || !imap.smtpPort || !imap.smtpSecurity) return null;
  return {
    email: view.emailAddress,
    ...(imap.username ? { username: imap.username } : {}),
    ...(imap.smtpUsername ? { smtpUsername: imap.smtpUsername } : {}),
    imap: { host: imap.imapHost, port: imap.imapPort, security: imap.imapSecurity },
    smtp: { host: imap.smtpHost, port: imap.smtpPort, security: imap.smtpSecurity },
  };
}

type StoredServers = { ok: true; servers: NonNullable<ReturnType<typeof storedServers>> } | { ok: false; error: string };

/** Loads the IMAP mailbox's view; demo mailboxes never reach a server ([ARR-11]). */
async function imapServersOf(actor: Actor, channelId: string): Promise<StoredServers> {
  const view = await getEmailChannelView(actor, channelId);
  if (view.type !== "email_imap") return { ok: false, error: "Esto solo vale para buzones IMAP/SMTP." };
  if (view.isDemo) return { ok: false, error: "Un buzón de demostración no se conecta a ningún servidor." };
  const servers = storedServers(view);
  return servers ? { ok: true, servers } : { ok: false, error: WIZARD_NEEDED };
}

export type EmailConnectionTest = {
  passed: boolean;
  /** Why IMAP (reading) or SMTP (sending) failed, in Spanish; null when it works. */
  imap: string | null;
  smtp: string | null;
  /** The server refused the user or the password: «Reconectar» with the new one. */
  wrongPassword: boolean;
};

/** «Probar conexión»: IMAP and SMTP with the stored settings and password; nothing is stored ([COR-11]). */
export async function testEmailConnectionAction(channelId: unknown): Promise<ActionResult<EmailConnectionTest>> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    const stored = await imapServersOf(actor, id.data);
    if (!stored.ok) return fail(stored.error);
    const result = await testEmailServers(actor, { channelId: id.data, ...stored.servers });
    if (result.ok) return ok({ passed: true, imap: null, smtp: null, wrongPassword: false }, "La entrada (IMAP) y el envío (SMTP) funcionan.");
    return ok({ passed: false, imap: result.imap, smtp: result.smtp, wrongPassword: result.wrongPassword });
  } catch (error) {
    return toActionFailure(error);
  }
}

// ─── Reconectar ([COR-22], [COR-23]) ────────────────────────────────────────────────────────────────────

const oauthReconnectSchema = z
  .object({
    /** Empty: the stored one. Required when none is stored. */
    clientSecret: z.preprocess(blankToUndefined, z.string().trim().max(300).optional()),
    /** Outlook only, with a new secret: YYYY-MM-DD. */
    clientSecretExpiresAt: z.preprocess(blankToUndefined, z.string().trim().max(10).optional()),
  })
  .strict();

const SECRET_REQUIRED = { clientSecret: ["Pega el Client Secret."] };
const EXPIRY_REQUIRED = { clientSecretExpiresAt: ["Escribe la fecha de caducidad del Client Secret nuevo."] };

/**
 * «Reconectar» Gmail or Outlook: the new Client Secret first when one is typed (stored encrypted, only for the same
 * client), then the consent URL with state and PKCE for this person. The browser goes there; nothing else changes until
 * Google or Microsoft answer, and the same mailbox keeps its reading point.
 */
export async function reconnectEmailOAuthAction(channelId: unknown, input: unknown): Promise<ActionResult<{ url: string }>> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    const parsed = oauthReconnectSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const { clientSecret, clientSecretExpiresAt } = parsed.data;
    const [channel, view] = await Promise.all([getChannel(actor, id.data), getEmailChannelView(actor, id.data)]);
    if (view.isDemo) return fail("Un buzón de demostración no se conecta a ningún servicio.");
    if (view.type === "email_gmail") {
      const clientId = view.gmail?.clientId;
      if (!clientId) return fail(WIZARD_NEEDED);
      if (!clientSecret && !channel.hasSecrets) return fail("Revisa los campos marcados.", SECRET_REQUIRED);
      if (clientSecret) await saveGmailCredentials(actor, { channelId: id.data, clientId, clientSecret });
      return ok(await startGmailOAuth(actor, { channelId: id.data }));
    }
    if (view.type === "email_outlook") {
      const { clientId, tenant } = view.outlook ?? {};
      if (!clientId || !tenant) return fail(WIZARD_NEEDED);
      if (!clientSecret && !channel.hasSecrets) return fail("Revisa los campos marcados.", SECRET_REQUIRED);
      if (clientSecret) {
        if (!clientSecretExpiresAt) return fail("Revisa los campos marcados.", EXPIRY_REQUIRED);
        await saveOutlookCredentials(actor, { channelId: id.data, clientId, tenant, clientSecret, clientSecretExpiresAt });
      }
      return ok(await startOutlookOAuth(actor, { channelId: id.data }));
    }
    return fail("Los buzones IMAP/SMTP se reconectan con su contraseña.");
  } catch (error) {
    return toActionFailure(error);
  }
}

const imapReconnectSchema = z
  .object({
    password: z.string().min(1, "Escribe la contraseña del buzón.").max(500, "La contraseña es demasiado larga."),
    /** Only when SMTP has its own password. */
    smtpPassword: z.preprocess(blankToUndefined, z.string().max(500, "La contraseña es demasiado larga.").optional()),
  })
  .strict();

/** «Reconectar» IMAP/SMTP: the stored servers with the new password; stored only if IMAP and SMTP both work ([COR-11]). */
export async function reconnectImapAction(channelId: unknown, input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    const parsed = imapReconnectSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const stored = await imapServersOf(actor, id.data);
    if (!stored.ok) return fail(stored.error);
    const result = await connectImapChannel(actor, { channelId: id.data, ...stored.servers, ...parsed.data });
    if (!result.ok) {
      const wrongPassword = result.result !== null && !result.result.ok && result.result.wrongPassword;
      return fail(result.error, wrongPassword ? { password: [result.error] } : undefined);
    }
    revalidateChannels();
    return ok(undefined, "Buzón conectado de nuevo: sigue leyendo desde donde se quedó.");
  } catch (error) {
    return toActionFailure(error);
  }
}

const outlookSecretSchema = z
  .object({
    clientSecret: z.string().trim().min(1, "Pega el Client Secret nuevo.").max(300),
    clientSecretExpiresAt: z.string({ error: "Escribe su fecha de caducidad." }).trim().min(1, "Escribe su fecha de caducidad.").max(10),
  })
  .strict();

/**
 * A new Outlook Client Secret before the old one expires ([COR-07], [COR-22]): same client and tenant, so the tokens
 * stay and nothing needs connecting again; the «caduca pronto» notice can be given again for the new date.
 */
export async function changeOutlookSecretAction(channelId: unknown, input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    const parsed = outlookSecretSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const view = await getEmailChannelView(actor, id.data);
    if (view.type !== "email_outlook") return fail("Esto solo vale para buzones de Outlook.");
    const { clientId, tenant } = view.outlook ?? {};
    if (!clientId || !tenant) return fail(WIZARD_NEEDED);
    await saveOutlookCredentials(actor, { channelId: id.data, clientId, tenant, ...parsed.data });
    revalidateChannels();
    return ok(undefined, "Client Secret cambiado. Se avisará otra vez 30 días antes de su nueva fecha de caducidad.");
  } catch (error) {
    return toActionFailure(error);
  }
}

/** The administrator's consent link when Microsoft asks for it ([COR-07]); not with the `common` tenant. */
export async function adminConsentAction(channelId: unknown): Promise<ActionResult<{ url: string }>> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    const { url } = await outlookAdminConsentUrl(actor, { channelId: id.data });
    if (!url) return fail("Con el tenant «common» no hay enlace de consentimiento: pon el Tenant ID del negocio en el asistente de correo.");
    return ok({ url });
  } catch (error) {
    return toActionFailure(error);
  }
}

// ─── Desconectar ([CAN-16]) ─────────────────────────────────────────────────────────────────────────────

/** Revokes the access where the provider allows it (Google), erases the stored credentials and stops reading. */
export async function disconnectEmailAction(channelId: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    await disconnectEmailChannel(actor, { channelId: id.data });
    revalidateChannels();
    return ok(undefined, "Buzón desconectado: se han borrado sus credenciales y sus conversaciones se conservan.");
  } catch (error) {
    return toActionFailure(error);
  }
}

