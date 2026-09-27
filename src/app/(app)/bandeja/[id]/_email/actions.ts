"use server";
// The email thread of the conversation screen ([BAN-09], [BAN-11], [BAN-14], [COR-14], [COR-19], [COR-21]). Thin:
// session and the area permission here, the input validated with src/data's schemas, which checks the conversation's
// channel again ([SEG-04], [PER-02]); Solo lectura only reads ([PER-03]). Approving or editing a draft is the inbox's
// own approveDraftAction. Changes refresh the conversation on screen.
import { refresh } from "next/cache";
import {
  discardEmailDraft,
  emailQuotedTextSchema,
  emailReplySchema,
  emailThreadSchema,
  getEmailQuotedText,
  getEmailThread,
  sendEmailReply,
  type EmailMessageView,
  type EmailQuotedText,
} from "@/data/email-drafts";
import { discardDraftSchema, MAX_ATTACHMENT_BYTES } from "@/data/messages";
import { fail, fromZodError, ok, type ActionResult } from "@/lib/action-result";
import { PERMISSIONS } from "@/lib/permissions";
import { toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";
import type { SentMessage } from "../../actions";

/** The details of emails of the thread that were not on the first page («Cargar anteriores»). */
export async function loadEmailDetailsAction(input: unknown): Promise<ActionResult<Record<string, EmailMessageView>>> {
  try {
    const actor = await requirePermission(PERMISSIONS.inbox.view);
    const parsed = emailThreadSchema.safeParse(input);
    if (!parsed.success) return fail("No se ha encontrado la conversación.");
    const thread = await getEmailThread(actor, parsed.data);
    return ok(thread?.messages ?? {});
  } catch (error) {
    return toActionFailure(error);
  }
}

/** «Mostrar el texto citado» / «Ver el correo completo» of one email ([COR-19]). */
export async function loadQuotedTextAction(input: unknown): Promise<ActionResult<EmailQuotedText>> {
  try {
    const actor = await requirePermission(PERMISSIONS.inbox.view);
    const parsed = emailQuotedTextSchema.safeParse(input);
    if (!parsed.success) return fail("No se ha encontrado el correo.");
    return ok(await getEmailQuotedText(actor, parsed.data));
  } catch (error) {
    return toActionFailure(error);
  }
}

/** A person's reply to the email, with the business signature; it pauses the AI ([BAN-11], [COR-21]). */
export async function sendEmailReplyAction(input: unknown): Promise<ActionResult<SentMessage>> {
  try {
    const actor = await requirePermission(PERMISSIONS.inbox.reply);
    const parsed = emailReplySchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const sent = await sendEmailReply(actor, parsed.data);
    refresh();
    return ok({ status: sent.status, aiPausedUntil: sent.aiPausedUntil });
  } catch (error) {
    return toActionFailure(error);
  }
}

/**
 * The same with an image or a PDF attached ([BAN-14]). The permission is checked before the file is read; the data
 * layer checks its content and size again.
 */
export async function sendEmailAttachmentAction(formData: FormData): Promise<ActionResult<SentMessage>> {
  try {
    const actor = await requirePermission(PERMISSIONS.inbox.reply);
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return fail("Revisa los campos marcados.", { file: ["Elige un archivo."] });
    if (file.size > MAX_ATTACHMENT_BYTES) return fail("Revisa los campos marcados.", { file: ["El archivo es demasiado grande. Como mucho, 3,5 MB."] });
    const text = formData.get("text");
    const parsed = emailReplySchema.safeParse({ conversationId: formData.get("conversationId"), ...(typeof text === "string" ? { text } : {}) });
    if (!parsed.success) return fromZodError(parsed.error);
    const sent = await sendEmailReply(actor, parsed.data, { bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name });
    refresh();
    return ok({ status: sent.status, aiPausedUntil: sent.aiPausedUntil });
  } catch (error) {
    return toActionFailure(error);
  }
}

/** «Descartar» the AI's draft: gone from the inbox and from the mailbox's drafts at once ([COR-14]). */
export async function discardEmailDraftAction(input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.inbox.drafts);
    const parsed = discardDraftSchema.safeParse(input);
    if (!parsed.success) return fail("No se ha encontrado el mensaje.");
    await discardEmailDraft(actor, parsed.data);
    refresh();
    return ok();
  } catch (error) {
    return toActionFailure(error);
  }
}
