// «Sincronizar plantillas» ([WA-22], docs/integracion-whatsapp.md §5.8): every template of the number's WABA, with its
// status, category, language, variables, components and own time-to-live, into `whatsapp_templates` (unique channel +
// name + language). What the provider no longer returns is removed, except a template just created from the app that
// its list may not show yet. What the app keeps of each one (its data and buttons, [WA-58]) survives every sync. A
// rejection or a change of category is noted on the row and told to the owner and the admins ([WA-60], [AJU-08]).
// Status webhooks keep the table up to date between syncs (account-events.ts); the 6 h health check runs a full sync.
import "server-only";
import { and, eq, gt, not, notInArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { whatsappTemplates } from "@/db/schema";
import { templateVariableNames } from "@/lib/meta/templates";
import type { ChannelRecord } from "../types";
import { graphClientFor, WhatsAppNotConnectedError, type WhatsAppDeps } from "./config";
import { notifyTemplateChanges, type TemplateChange } from "./template-changes";

export const TEMPLATES_SYNC_JOB = "wa.templates_sync";
export const templatesSyncPayload = z.object({ channelId: z.uuid() });
export const templatesSyncDedupeKey = (channelId: string) => `wa.templates_sync:${channelId}`;

export type TemplatesSyncResult = { total: number; approved: number };

/** A template as its provider lists it (Meta's Graph API, or YCloud with Meta's same components). */
export type SyncedTemplate = {
  id?: string | null;
  name: string;
  language: string;
  category?: string | null;
  status?: string | null;
  components?: unknown[] | null;
  rejectedReason?: string | null;
  parameterFormat?: string | null;
  ttlSeconds?: number | null;
};

/** A template created from the app may take a while to show in the provider's list: kept that long. */
const JUST_CREATED_MS = 24 * 60 * 60 * 1_000;

const upper = (value: string | null | undefined) => value?.toUpperCase() ?? null;

/**
 * Leaves `whatsapp_templates` of a channel as the provider's list says: each template inserted or refreshed (unique
 * channel + name + language) and what it no longer returns removed. Returns what changed for the notices.
 */
export async function storeWhatsAppTemplates(channelId: string, templates: readonly SyncedTemplate[], now: Date = new Date()): Promise<TemplatesSyncResult> {
  const keep: string[] = [];
  const changes: TemplateChange[] = [];
  await db.transaction(async (tx) => {
    const existing = await tx.select().from(whatsappTemplates).where(eq(whatsappTemplates.channelId, channelId));
    const byKey = new Map(existing.map((row) => [`${row.name}\u0000${row.language}`, row]));
    for (const template of templates) {
      const before = byKey.get(`${template.name}\u0000${template.language}`);
      const category = template.category ?? null;
      const status = template.status ?? null;
      const categoryChanged = Boolean(before?.category && category && upper(before.category) !== upper(category));
      if (categoryChanged && category) changes.push({ kind: "category_changed", channelId, name: template.name, from: before?.category ?? null, to: category });
      const rejectedReason = template.rejectedReason && template.rejectedReason !== "NONE" ? template.rejectedReason : null;
      if (before && upper(status) === "REJECTED" && upper(before.status) !== "REJECTED") changes.push({ kind: "rejected", channelId, name: template.name, reason: rejectedReason });
      const values = {
        metaTemplateId: template.id ?? null,
        category,
        status,
        components: template.components ?? [],
        variables: templateVariableNames(template.components ?? []),
        rejectedReason,
        parameterFormat: template.parameterFormat ?? before?.parameterFormat ?? null,
        ttlSeconds: template.ttlSeconds ?? null,
        ...(categoryChanged ? { previousCategory: before?.category ?? null, categoryChangedAt: now, upcomingCategory: null, upcomingCategoryAt: null } : {}),
        lastSyncedAt: now,
        updatedAt: now,
      };
      const [row] = await tx
        .insert(whatsappTemplates)
        .values({ channelId, name: template.name, language: template.language, ...values, createdAt: now })
        .onConflictDoUpdate({ target: [whatsappTemplates.channelId, whatsappTemplates.name, whatsappTemplates.language], set: values })
        .returning({ id: whatsappTemplates.id });
      keep.push(row.id);
    }
    const justCreated = and(eq(whatsappTemplates.createdInApp, true), gt(whatsappTemplates.createdAt, new Date(now.getTime() - JUST_CREATED_MS)));
    await tx
      .delete(whatsappTemplates)
      .where(and(eq(whatsappTemplates.channelId, channelId), ...(keep.length > 0 ? [notInArray(whatsappTemplates.id, keep)] : []), not(justCreated!)));
  });
  await notifyTemplateChanges(changes);
  return { total: templates.length, approved: templates.filter((template) => template.status?.toUpperCase() === "APPROVED").length };
}

export async function syncWhatsAppTemplates(channel: ChannelRecord, deps: WhatsAppDeps = {}): Promise<TemplatesSyncResult> {
  if (!channel.wabaId) throw new WhatsAppNotConnectedError();
  const templates = await graphClientFor(channel, deps).listTemplates(channel.wabaId);
  return storeWhatsAppTemplates(
    channel.id,
    templates.map((template) => ({
      ...template,
      rejectedReason: template.rejected_reason,
      parameterFormat: template.parameter_format,
      ttlSeconds: template.message_send_ttl_seconds,
    })),
    deps.now?.() ?? new Date(),
  );
}
