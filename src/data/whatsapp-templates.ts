// WhatsApp templates of a channel ([WA-22], [WA-42], [WA-43], [BAN-08]): the synced list (panel and inbox), «Sincronizar»
// and the message a person sends outside the 24 h window, built from an APPROVED template and its values. Seeing the
// list: «Canales: ver», or «Bandeja: responder» in that channel (the inbox picks one); syncing: owner and admin.
import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { whatsappTemplates } from "@/db/schema";
import { buildTemplateSend, renderTemplateText, TEMPLATE_METADATA_KEY, TemplateBuildError } from "@/lib/meta/templates";
import { can, PERMISSIONS, type Actor } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import type { WhatsAppDeps } from "@/server/channels/whatsapp/config";
import { syncWhatsAppTemplates, type TemplatesSyncResult } from "@/server/channels/whatsapp/templates";
import { AuthError, NotFoundError, parseInput, ValidationError } from "@/server/errors";
import { writeAudit } from "./audit";
import { assertCan } from "./guard";
import { loadWhatsAppChannel } from "./whatsapp";

export type WhatsAppTemplateItem = {
  id: string;
  name: string;
  language: string;
  category: string | null;
  status: string | null;
  /** Names of the values it needs, header first («1», «2»… or named). */
  variables: string[];
  components: unknown[];
  rejectedReason: string | null;
  lastSyncedAt: Date | null;
};

const isApproved = (status: string | null) => status?.toUpperCase() === "APPROVED";

function assertCanSeeTemplates(actor: Actor, channelId: string): void {
  if (!can(actor, PERMISSIONS.channels.view) && !can(actor, PERMISSIONS.inbox.reply, { channelId })) throw new AuthError("forbidden");
}

export async function listWhatsAppTemplates(actor: Actor, channelId: string, options: { approvedOnly?: boolean } = {}): Promise<WhatsAppTemplateItem[]> {
  const channel = await loadWhatsAppChannel(channelId, { allowDemo: true });
  assertCanSeeTemplates(actor, channel.id);
  const rows = await db
    .select()
    .from(whatsappTemplates)
    .where(eq(whatsappTemplates.channelId, channel.id))
    .orderBy(asc(whatsappTemplates.name), asc(whatsappTemplates.language));
  return rows
    .filter((row) => !options.approvedOnly || isApproved(row.status))
    .map((row) => ({
      id: row.id,
      name: row.name,
      language: row.language,
      category: row.category,
      status: row.status,
      variables: row.variables,
      components: row.components,
      rejectedReason: row.rejectedReason,
      lastSyncedAt: row.lastSyncedAt,
    }));
}

/** «Sincronizar plantillas» ([WA-22]). */
export async function syncWhatsAppTemplatesNow(actor: Actor, channelId: string, deps: WhatsAppDeps = {}): Promise<TemplatesSyncResult> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const channel = await loadWhatsAppChannel(channelId);
  const result = await syncWhatsAppTemplates(channel, deps);
  await writeAudit({ actor, action: "channel.templates_synced", targetType: "channel", targetId: channel.id, metadata: { total: result.total } });
  return result;
}

export const templateMessageSchema = z
  .object({
    templateId: idSchema,
    /** Value of each variable, by name («1», «nombre»…). */
    values: z.record(z.string().max(60), z.string().max(1_024)).default({}),
    /** Uploaded media id for a template with an image, video or document header. */
    headerMediaId: z.string().regex(/^\d{1,32}$/).nullish(),
  })
  .strict();

type TemplateRow = typeof whatsappTemplates.$inferSelect;

/**
 * System: the text (for the inbox) and the `messages.metadata` of an APPROVED template row with its values, ready for
 * sendOutbound with contentType "template": the WhatsApp adapter sends `metadata.whatsappTemplate` as it is. The table
 * keeps no parameter_format, so a variable that is not a number means NAMED. Shared by the inbox and the app's own
 * messages (sendTemplateMessage). ValidationError when it is not approved or a value is missing or too long.
 */
export function templateMessageOf(
  template: TemplateRow,
  values: Readonly<Record<string, string>>,
  headerMediaId?: string | null,
): { text: string; metadata: Record<string, unknown> } {
  if (!isApproved(template.status)) throw new ValidationError("Esta plantilla no está aprobada por Meta.");
  try {
    const send = buildTemplateSend({
      name: template.name,
      language: template.language,
      parameterFormat: template.variables.some((name) => !/^\d+$/.test(name)) ? "NAMED" : "POSITIONAL",
      components: template.components,
      values,
      headerMediaId,
    });
    return { text: renderTemplateText(template.components, values), metadata: { [TEMPLATE_METADATA_KEY]: send, templateId: template.id } };
  } catch (error) {
    if (error instanceof TemplateBuildError) throw new ValidationError(error.message);
    throw error;
  }
}

/** The message a person sends from the inbox with an APPROVED template of the channel ([WA-43], [BAN-08]). */
export async function buildWhatsAppTemplateMessage(
  actor: Actor,
  channelId: string,
  input: unknown,
): Promise<{ text: string; metadata: Record<string, unknown>; template: { name: string; language: string } }> {
  const data = parseInput(templateMessageSchema, input);
  // Nothing is sent here: on a demo channel the DemoAdapter only stores the message ([ARR-11]).
  const channel = await loadWhatsAppChannel(channelId, { allowDemo: true });
  assertCan(actor, PERMISSIONS.inbox.reply, { channelId: channel.id });
  const [template] = await db.select().from(whatsappTemplates).where(and(eq(whatsappTemplates.id, data.templateId), eq(whatsappTemplates.channelId, channel.id)));
  if (!template) throw new NotFoundError("No se ha encontrado la plantilla.");
  return { ...templateMessageOf(template, data.values, data.headerMediaId), template: { name: template.name, language: template.language } };
}
