// WhatsApp templates of a channel ([WA-22], [WA-42], [WA-43], [BAN-08]): the synced list (panel and inbox), «Sincronizar»
// and the message a person sends outside the 24 h window, built from an APPROVED template and its values. Seeing the
// list: «Canales: ver», or «Bandeja: responder» in that channel (the inbox picks one); syncing: owner and admin.
import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { whatsappTemplates } from "@/db/schema";
import { TEMPLATE_BUTTON_ROLES, type TemplateButtonRole } from "@/lib/enums";
import { isMetaGraphError } from "@/lib/meta/errors";
import { buildTemplateSend, renderTemplateText, TEMPLATE_METADATA_KEY, TemplateBuildError, templateVariableNames } from "@/lib/meta/templates";
import { whatsappViaOf } from "@/lib/whatsapp-via";
import { buildTemplateRequest, draftErrors, quickReplyButtons, TEMPLATE_NAME_MAX } from "@/lib/whatsapp-template-draft";
import { YCloudApiError } from "@/lib/ycloud/errors";
import { can, PERMISSIONS, type Actor } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { graphClientFor, type WhatsAppDeps } from "@/server/channels/whatsapp/config";
import { notifyTemplateChanges } from "@/server/channels/whatsapp/template-changes";
import { syncWhatsAppTemplates, type TemplatesSyncResult } from "@/server/channels/whatsapp/templates";
import { ycloudClientFor, type YCloudDeps } from "@/server/channels/ycloud/config";
import { AuthError, ConflictError, NotFoundError, parseInput, ValidationError } from "@/server/errors";
import { writeAudit } from "./audit";
import { enforceWhatsAppLimit } from "./whatsapp-limits";
import { assertCan } from "./guard";
import { loadBusinessSettings } from "./settings";
import { loadWhatsAppChannel, OFFICIAL_WHATSAPP_VIAS } from "./whatsapp";

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
  /** Created with «Nueva plantilla», and the category asked for ([WA-57], [WA-60]). */
  createdInApp: boolean;
  requestedCategory: string | null;
  /** A change of category done or announced ([WA-60]). */
  previousCategory: string | null;
  categoryChangedAt: Date | null;
  upcomingCategory: string | null;
  upcomingCategoryAt: Date | null;
  ttlSeconds: number | null;
  /** Its quick-reply buttons and what each one does ([AGD-32], [WA-62]). */
  quickReplies: string[];
  buttonRoles: Record<string, TemplateButtonRole>;
  /** Variable → data, for those created from the app ([WA-58]). */
  variableBindings: Record<string, string>;
};

const isApproved = (status: string | null) => status?.toUpperCase() === "APPROVED";

function assertCanSeeTemplates(actor: Actor, channelId: string): void {
  if (!can(actor, PERMISSIONS.channels.view) && !can(actor, PERMISSIONS.inbox.reply, { channelId })) throw new AuthError("forbidden");
}

export async function listWhatsAppTemplates(actor: Actor, channelId: string, options: { approvedOnly?: boolean } = {}): Promise<WhatsAppTemplateItem[]> {
  const channel = await loadWhatsAppChannel(channelId, { allowDemo: true, vias: OFFICIAL_WHATSAPP_VIAS });
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
      createdInApp: row.createdInApp,
      requestedCategory: row.requestedCategory,
      previousCategory: row.previousCategory,
      categoryChangedAt: row.categoryChangedAt,
      upcomingCategory: row.upcomingCategory,
      upcomingCategoryAt: row.upcomingCategoryAt,
      ttlSeconds: row.ttlSeconds,
      quickReplies: quickReplyButtons(row.components),
      buttonRoles: row.buttonRoles,
      variableBindings: row.variableBindings,
    }));
}

const buttonRolesSchema = z
  .object({ templateId: idSchema, roles: z.record(z.string().max(60), z.enum(TEMPLATE_BUTTON_ROLES).nullable()) })
  .strict();

/**
 * What each quick-reply button of a template does ([AGD-32], [WA-62]): in those created from the app it comes set; in
 * the synced ones it is chosen by hand («Canales: …plantillas de WhatsApp»). A role at most once per template.
 */
export async function setTemplateButtonRoles(actor: Actor, input: unknown): Promise<void> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const data = parseInput(buttonRolesSchema, input);
  const [template] = await db.select().from(whatsappTemplates).where(eq(whatsappTemplates.id, data.templateId));
  if (!template) throw new NotFoundError("No se ha encontrado la plantilla.");
  await loadWhatsAppChannel(template.channelId, { allowDemo: true, vias: OFFICIAL_WHATSAPP_VIAS });
  const buttons = new Set(quickReplyButtons(template.components));
  const roles: Record<string, TemplateButtonRole> = {};
  for (const [text, role] of Object.entries(data.roles)) {
    if (!role) continue;
    if (!buttons.has(text)) throw new ValidationError("Ese botón no es de la plantilla.");
    if (Object.values(roles).includes(role)) throw new ValidationError("Cada cosa la hace un solo botón.");
    roles[text] = role;
  }
  await db.update(whatsappTemplates).set({ buttonRoles: roles, updatedAt: new Date() }).where(eq(whatsappTemplates.id, template.id));
  await writeAudit({ actor, action: "channel.template_buttons_set", targetType: "channel", targetId: template.channelId, metadata: { buttons: Object.values(roles) } });
}

/** «Sincronizar plantillas» ([WA-22]). */
export async function syncWhatsAppTemplatesNow(actor: Actor, channelId: string, deps: WhatsAppDeps = {}): Promise<TemplatesSyncResult> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const channel = await loadWhatsAppChannel(channelId);
  const result = await syncWhatsAppTemplates(channel, deps);
  await writeAudit({ actor, action: "channel.templates_synced", targetType: "channel", targetId: channel.id, metadata: { total: result.total } });
  return result;
}

// ─── «Nueva plantilla» ([WA-57]–[WA-59], [YC-07]) ────────────────────────────────────────────────────────

const draftSchema = z
  .object({
    name: z.string().trim().min(1).max(TEMPLATE_NAME_MAX),
    language: z.string().trim().min(2).max(10),
    category: z.enum(["UTILITY", "MARKETING"]),
    header: z.string().max(200).default(""),
    body: z.string().max(2_000),
    footer: z.string().max(200).default(""),
    buttons: z
      .array(z.object({ text: z.string().max(60), role: z.enum(TEMPLATE_BUTTON_ROLES).nullable().default(null) }).strict())
      .max(20)
      .default([]),
    ttlSeconds: z.number().int().nullable().default(null),
  })
  .strict();

/** Meta's template creation errors (docs/integracion-whatsapp-plantillas.md §1), in Spanish. */
const CREATION_ERRORS: Record<number, string> = {
  2388040: "Un texto es demasiado largo para Meta.",
  2388047: "Meta no acepta el formato del encabezado.",
  2388072: "Meta no acepta el formato del texto.",
  2388073: "Meta no acepta el formato del pie.",
  2388293: "Hay demasiados datos para lo largo que es el texto.",
  2388299: "El texto no puede empezar ni terminar con un dato.",
  2388019: "La cuenta ha llegado al máximo de plantillas.",
};

function creationError(error: unknown): Error {
  const code = isMetaGraphError(error) ? (error.subcode ?? error.code) : error instanceof YCloudApiError ? error.metaCode : null;
  const known = code !== null ? CREATION_ERRORS[code] : undefined;
  if (known) return new ValidationError(known);
  if (isMetaGraphError(error) || error instanceof YCloudApiError) return new ConflictError(error.userMessage);
  return error instanceof Error ? error : new Error("No se ha podido crear la plantilla.");
}

export type CreatedTemplateResult = { id: string; status: string; category: string | null };

/**
 * «Nueva plantilla»: sends it to Meta, or to YCloud which passes it on, and keeps it «En revisión» until the answer
 * ([WA-22], [WA-57]); on a demo channel it is approved at once, without calling anyone ([ARR-25]). The app remembers
 * which data fills each variable and what each button does ([WA-58]). Owner and admin («Canales: …plantillas de
 * WhatsApp»).
 */
export async function createWhatsAppTemplate(
  actor: Actor,
  channelId: string,
  input: unknown,
  deps: WhatsAppDeps & YCloudDeps = {},
): Promise<CreatedTemplateResult> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const data = parseInput(draftSchema, input);
  const errors = draftErrors(data);
  if (Object.keys(errors).length) throw new ValidationError("Revisa la plantilla.", Object.fromEntries(Object.entries(errors).map(([key, message]) => [key, [message]])));
  const channel = await loadWhatsAppChannel(channelId, { allowDemo: true, vias: OFFICIAL_WHATSAPP_VIAS });
  const [taken] = await db
    .select({ id: whatsappTemplates.id })
    .from(whatsappTemplates)
    .where(and(eq(whatsappTemplates.channelId, channel.id), eq(whatsappTemplates.name, data.name), eq(whatsappTemplates.language, data.language)));
  if (taken) throw new ValidationError("Ya hay una plantilla con ese nombre en ese idioma.", { name: ["Ya hay una plantilla con ese nombre en ese idioma."] });
  await enforceWhatsAppLimit("createTemplate", actor.userId);
  const business = await loadBusinessSettings();
  const via = whatsappViaOf(channel);
  const built = buildTemplateRequest(data, { provider: via === "ycloud" ? "ycloud" : "meta", businessName: business.name, wabaId: channel.wabaId ?? undefined });

  let answer: { id: string | null; status: string; category: string | null; ttlSeconds: number | null };
  if (channel.isDemo) {
    answer = { id: null, status: "APPROVED", category: data.category, ttlSeconds: data.ttlSeconds };
  } else {
    if (!channel.wabaId) throw new ConflictError("El número no está conectado.");
    try {
      if (via === "ycloud") {
        const created = await ycloudClientFor(channel, deps).createTemplate(built.request);
        answer = { id: created.officialTemplateId ?? null, status: created.status ?? "PENDING", category: created.category ?? data.category, ttlSeconds: created.messageSendTtlSeconds ?? data.ttlSeconds };
      } else {
        const created = await graphClientFor(channel, deps).createTemplate(channel.wabaId, built.request);
        answer = { id: created.id, status: created.status, category: created.category ?? data.category, ttlSeconds: data.ttlSeconds };
      }
    } catch (error) {
      throw creationError(error);
    }
  }
  const now = deps.now?.() ?? new Date();
  const [row] = await db
    .insert(whatsappTemplates)
    .values({
      channelId: channel.id,
      metaTemplateId: answer.id,
      name: data.name,
      language: data.language,
      category: answer.category,
      status: answer.status,
      components: built.components,
      variables: templateVariableNames(built.components),
      parameterFormat: built.parameterFormat,
      createdInApp: true,
      requestedCategory: data.category,
      variableBindings: built.bindings,
      buttonRoles: built.buttonRoles,
      ttlSeconds: answer.ttlSeconds,
      lastSyncedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: whatsappTemplates.id });
  await writeAudit({
    actor,
    action: "channel.template_created",
    targetType: "channel",
    targetId: channel.id,
    metadata: { category: data.category, approvedAs: answer.category, language: data.language },
  });
  if (answer.category && answer.category.toUpperCase() !== data.category) {
    await notifyTemplateChanges([{ kind: "category_changed", channelId: channel.id, name: data.name, from: data.category, to: answer.category }]);
  }
  return { id: row.id, status: answer.status, category: answer.category };
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
 * sendOutbound with contentType "template": the WhatsApp adapter sends `metadata.whatsappTemplate` as it is. Rows
 * synced before phase 12 keep no parameter_format: there, a variable that is not a number means NAMED. Shared by the inbox and the app's own
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
      parameterFormat: template.parameterFormat ?? (template.variables.some((name) => !/^\d+$/.test(name)) ? "NAMED" : "POSITIONAL"),
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
): Promise<{ text: string; metadata: Record<string, unknown>; template: { name: string; language: string }; row: TemplateRow }> {
  const data = parseInput(templateMessageSchema, input);
  // Nothing is sent here: on a demo channel the DemoAdapter only stores the message ([ARR-11]).
  const channel = await loadWhatsAppChannel(channelId, { allowDemo: true, vias: OFFICIAL_WHATSAPP_VIAS });
  assertCan(actor, PERMISSIONS.inbox.reply, { channelId: channel.id });
  const [template] = await db.select().from(whatsappTemplates).where(and(eq(whatsappTemplates.id, data.templateId), eq(whatsappTemplates.channelId, channel.id)));
  if (!template) throw new NotFoundError("No se ha encontrado la plantilla.");
  return { ...templateMessageOf(template, data.values, data.headerMediaId), template: { name: template.name, language: template.language }, row: template };
}
