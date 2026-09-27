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

export async function syncWhatsAppTemplates(channel: ChannelRecord, deps: WhatsAppDeps = {}): Promise<TemplatesSyncResult> {
  if (!channel.wabaId) throw new WhatsAppNotConnectedError();
  const templates = await graphClientFor(channel, deps).listTemplates(channel.wabaId);
  const now = deps.now?.() ?? new Date();
  const keep: string[] = [];
  await db.transaction(async (tx) => {
    for (const template of templates) {
      const values = {
        metaTemplateId: template.id,
        category: template.category ?? null,
        status: template.status ?? null,
        components: template.components ?? [],
        variables: templateVariableNames(template.components ?? []),
        rejectedReason: template.rejected_reason && template.rejected_reason !== "NONE" ? template.rejected_reason : null,
        lastSyncedAt: now,
        updatedAt: now,
      };
      const [row] = await tx
        .insert(whatsappTemplates)
        .values({ channelId: channel.id, name: template.name, language: template.language, ...values, createdAt: now })
        .onConflictDoUpdate({ target: [whatsappTemplates.channelId, whatsappTemplates.name, whatsappTemplates.language], set: values })
        .returning({ id: whatsappTemplates.id });
      keep.push(row.id);
    }
    await tx
      .delete(whatsappTemplates)
      .where(and(eq(whatsappTemplates.channelId, channel.id), ...(keep.length > 0 ? [notInArray(whatsappTemplates.id, keep)] : [])));
  });
  return { total: templates.length, approved: templates.filter((template) => template.status?.toUpperCase() === "APPROVED").length };
}
