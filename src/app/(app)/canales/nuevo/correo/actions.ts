"use server";
// Server Actions of the email wizard (Canales › Añadir › Correo, [COR-01]–[COR-11], [COR-14], [COR-17], [COR-21]). Thin:
// session and permission here (owner and admin, «Canales: crear, conectar…», [PER-01]), the form checked with the data
// layer's own Zod schemas so each field gets its message before anything is created ([SEG-05]), then src/data, which
// checks the permission again, validates again and never returns a secret ([SEG-02]). «Conectar con Google / Microsoft»
// only returns the provider's address: the browser goes there and the OAuth callback comes back to the wizard.
// «Agente activo» and the channel's AI use the actions of Canales (../../actions.ts), as the channel card does.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MAX_TEST_ALLOWLIST, updateChannel } from "@/data/channels";
import { createEmailChannel, createEmailChannelSchema, emailSettingsSchema, updateEmailSettings } from "@/data/email";
import {
  connectImapChannel,
  connectImapSchema,
  gmailCredentialsSchema,
  imapTestSchema,
  outlookAdminConsentUrl,
  outlookCredentialsSchema,
  saveGmailCredentials,
  saveOutlookCredentials,
  startGmailOAuth,
  startOutlookOAuth,
  suggestEmailServers,
  testEmailServers,
  type ConnectImapResult,
} from "@/data/email-connect";
import { fail, ok, type ActionFailure, type ActionResult } from "@/lib/action-result";
import { REPLY_MODES } from "@/lib/enums";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import { emailSchema, idSchema } from "@/lib/validation";
import type { EmailChannelType } from "@/server/channels/email/config";
import type { MailTestResult } from "@/server/channels/email/imap/connect";
import type { MailSuggestion } from "@/server/channels/email/imap/presets";
import { toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";

const NOT_FOUND = "No se ha encontrado el canal de correo.";
const INVALID_FORM = "Revisa los campos marcados.";
const SAVED = "Cambios guardados.";
const SECRET_REQUIRED = "Pega el Client Secret.";
const ADMIN_CONSENT_NEEDS_TENANT = "El consentimiento del administrador se pide con el Tenant ID del negocio, no con «common».";

/** Where the browser goes to connect, and the mailbox it belongs to. */
export type ConnectStart = { channelId: string; url: string };
/**
 * «Conectar con …»: a failure after the mailbox was created still names it, so the wizard keeps it and a second try
 * does not create another one.
 */
export type StartConnectResult = ActionResult<ConnectStart> | (ActionFailure & { channelId: string });

/** Canales, the channel's panel and the agents' «Activo en:» show the new state. */
function revalidateChannels(): void {
  revalidatePath("/canales", "layout");
  revalidatePath("/agentes", "layout");
}

async function manager(): Promise<Actor> {
  return requirePermission(PERMISSIONS.channels.manage);
}

/** The messages of each field, nested ones as «imap.host» so the form puts them under their own input. */
function invalid(error: z.ZodError): ActionFailure {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.filter((part) => typeof part === "string").join(".") || "_form";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return fail(INVALID_FORM, fieldErrors);
}

function failureOf(error: unknown, channelId: string | undefined): ActionFailure | (ActionFailure & { channelId: string }) {
  const failure = toActionFailure(error);
  return channelId ? { ...failure, channelId } : failure;
}

/** A new mailbox waiting for its connection, answering with drafts by default ([CAN-07], [COR-14]). */
async function newMailbox(actor: Actor, type: EmailChannelType, name: string): Promise<string> {
  const { id } = await createEmailChannel(actor, { type, name });
  revalidateChannels();
  return id;
}

// ─── Gmail ([COR-02]–[COR-04], [COR-23]) ────────────────────────────────────────────────────────────────

const newMailboxFields = { channelId: idSchema.optional(), name: createEmailChannelSchema.shape.name.optional() };
const gmailStartSchema = gmailCredentialsSchema.omit({ channelId: true }).extend(newMailboxFields).strict();

/**
 * «Conectar con Google»: creates the mailbox the first time, stores the business's own Client ID and Client Secret
 * (encrypted) and returns Google's consent address, with state and PKCE kept for the return ([COR-23]).
 */
export async function startGmailConnectAction(input: unknown): Promise<StartConnectResult> {
  let channelId: string | undefined;
  try {
    const actor = await manager();
    const parsed = gmailStartSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const { channelId: existing, name, ...credentials } = parsed.data;
    if (!existing && !credentials.clientSecret) return fail(INVALID_FORM, { clientSecret: [SECRET_REQUIRED] });
    channelId = existing ?? (await newMailbox(actor, "email_gmail", name ?? "Gmail"));
    await saveGmailCredentials(actor, { channelId, ...credentials });
    const { url } = await startGmailOAuth(actor, { channelId, from: "wizard" });
    return ok({ channelId, url });
  } catch (error) {
    return failureOf(error, channelId);
  }
}

// ─── Outlook ([COR-07], [COR-23]) ───────────────────────────────────────────────────────────────────────

const outlookStartSchema = outlookCredentialsSchema
  .omit({ channelId: true })
  .extend({ ...newMailboxFields, adminConsent: z.boolean().optional() })
  .strict();

/**
 * «Conectar con Microsoft» (or, with `adminConsent`, the administrator's consent link): creates the mailbox the first
 * time, stores the business's own Entra app (Client ID, encrypted Client Secret and its expiry, tenant) and returns
 * Microsoft's address.
 */
export async function startOutlookConnectAction(input: unknown): Promise<StartConnectResult> {
  let channelId: string | undefined;
  try {
    const actor = await manager();
    const parsed = outlookStartSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const { channelId: existing, name, adminConsent, ...credentials } = parsed.data;
    if (!existing && !credentials.clientSecret) return fail(INVALID_FORM, { clientSecret: [SECRET_REQUIRED] });
    channelId = existing ?? (await newMailbox(actor, "email_outlook", name ?? "Outlook"));
    await saveOutlookCredentials(actor, { channelId, ...credentials });
    if (adminConsent) {
      const { url } = await outlookAdminConsentUrl(actor, { channelId, from: "wizard" });
      if (!url) return { ...fail(INVALID_FORM, { tenant: [ADMIN_CONSENT_NEEDS_TENANT] }), channelId };
      return ok({ channelId, url });
    }
    const { url } = await startOutlookOAuth(actor, { channelId, from: "wizard" });
    return ok({ channelId, url });
  } catch (error) {
    return failureOf(error, channelId);
  }
}

// ─── Otro (IMAP/SMTP) ([COR-09]–[COR-11]) ───────────────────────────────────────────────────────────────

/** Servers filled in by the address's domain; Microsoft addresses are sent to Outlook ([COR-09], [COR-10]). */
export async function suggestEmailServersAction(email: unknown): Promise<ActionResult<MailSuggestion | null>> {
  try {
    const actor = await manager();
    return ok(suggestEmailServers(actor, email));
  } catch (error) {
    return toActionFailure(error);
  }
}

/** «Probar conexión»: IMAP and SMTP, each failure in Spanish; nothing is stored ([COR-11], [SEG-07]). */
export async function testImapServersAction(input: unknown): Promise<ActionResult<MailTestResult>> {
  try {
    const actor = await manager();
    const parsed = imapTestSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    return ok(await testEmailServers(actor, input));
  } catch (error) {
    return toActionFailure(error);
  }
}

/** «Conectar»: tested again and stored as connected only when IMAP and SMTP both work ([COR-11]). */
export async function connectImapAction(input: unknown): Promise<ActionResult<ConnectImapResult>> {
  try {
    const actor = await manager();
    const parsed = connectImapSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const result = await connectImapChannel(actor, input);
    if (result.ok) revalidateChannels();
    return ok(result);
  } catch (error) {
    return toActionFailure(error);
  }
}

// ─── Respuestas ([CAN-06], [CAN-07], [COR-14], [COR-17], [COR-21]) ──────────────────────────────────────

const repliesSchema = z
  .object({
    replyMode: z.enum(REPLY_MODES, { error: "Elige «Borrador para revisar» o «Automático»." }),
    signature: emailSettingsSchema.shape.signature,
    dailyCapPerThread: emailSettingsSchema.shape.dailyCapPerThread.unwrap(),
    dailyCapPerSender: emailSettingsSchema.shape.dailyCapPerSender.unwrap(),
    testMode: z.boolean(),
    testAllowlist: z.array(z.string().trim().min(1).max(254)).max(MAX_TEST_ALLOWLIST, `Como mucho ${MAX_TEST_ALLOWLIST} contactos.`),
  })
  .strict();

/**
 * «Guardar y terminar»: reply mode, daily caps, signature (the AI notice always goes after it) and the test mode with
 * its list. The list of a mailbox holds addresses: the sender's address is what the channel gives ([CAN-06]). Everything
 * is checked before anything is saved.
 */
export async function saveEmailRepliesAction(channelId: unknown, input: unknown): Promise<ActionResult> {
  try {
    const actor = await manager();
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    const parsed = repliesSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const { replyMode, signature, dailyCapPerThread, dailyCapPerSender, testMode, testAllowlist } = parsed.data;
    const addresses = testAllowlist.map((entry) => ({ entry, parsed: emailSchema.safeParse(entry) }));
    const wrong = addresses.filter((address) => !address.parsed.success).map((address) => address.entry);
    if (wrong.length > 0) return fail(INVALID_FORM, { testAllowlist: [`Escribe un email por línea. No son emails: ${wrong.join(", ")}.`] });
    const emails = addresses.flatMap((address) => (address.parsed.success ? [address.parsed.data] : []));
    // The email part first: it also proves the channel is a mailbox before the common settings change.
    await updateEmailSettings(actor, { channelId: id.data, signature, dailyCapPerThread, dailyCapPerSender });
    await updateChannel(actor, id.data, { replyMode, testMode, testAllowlist: emails });
    revalidateChannels();
    return ok(undefined, SAVED);
  } catch (error) {
    return toActionFailure(error);
  }
}
