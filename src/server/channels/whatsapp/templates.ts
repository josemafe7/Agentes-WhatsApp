// «Sincronizar plantillas» ([WA-22], docs/integracion-whatsapp.md §5.8): every template of the number's WABA, with its
// status, category, language, variables and components, into `whatsapp_templates` (unique channel + name +
// language). What Meta no longer returns is removed. Status webhooks keep the table up to date between syncs
// (account-events.ts); the 6 h health check runs a full sync to fix anything missed.
import "server-only";
import { and, eq, notInArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { whatsappTemplates } from "@/db/schema";
import { templateVariableNames } from "@/lib/meta/templates";
import type { ChannelRecord } from "../types";
import { graphClientFor, WhatsAppNotConnectedError, type WhatsAppDeps } from "./config";

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
};

/**
 * Leaves `whatsapp_templates` of a channel as the provider's list says: each template inserted or refreshed (unique
 * channel + name + language) and what it no longer returns removed.
 */
export async function storeWhatsAppTemplates(channelId: string, templates: readonly SyncedTemplate[], now: Date = new Date()): Promise<TemplatesSyncResult> {
  const keep: string[] = [];
  await db.transaction(async (tx) => {
    for (const template of templates) {
      const values = {
        metaTemplateId: template.id ?? null,
        category: template.category ?? null,
        status: template.status ?? null,
        components: template.components ?? [],
        variables: templateVariableNames(template.components ?? []),
        rejectedReason: template.rejectedReason && template.rejectedReason !== "NONE" ? template.rejectedReason : null,
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
    await tx
      .delete(whatsappTemplates)
      .where(and(eq(whatsappTemplates.channelId, channelId), ...(keep.length > 0 ? [notInArray(whatsappTemplates.id, keep)] : [])));
  });
  return { total: templates.length, approved: templates.filter((template) => template.status?.toUpperCase() === "APPROVED").length };
}

export async function syncWhatsAppTemplates(channel: ChannelRecord, deps: WhatsAppDeps = {}): Promise<TemplatesSyncResult> {
  if (!channel.wabaId) throw new WhatsAppNotConnectedError();
  const templates = await graphClientFor(channel, deps).listTemplates(channel.wabaId);
  return storeWhatsAppTemplates(
    channel.id,
    templates.map((template) => ({ ...template, rejectedReason: template.rejected_reason })),
    deps.now?.() ?? new Date(),
  );
}
