// «Sincronizar plantillas» of a number connected through YCloud ([YC-07], [WA-22]): the templates of its WhatsApp
// Business account as YCloud lists them (Meta's own components), into the same `whatsapp_templates` the direct
// connection uses, so the inbox and the reminders work with them as they are.
import "server-only";
import { z } from "zod";
import { storeWhatsAppTemplates, type TemplatesSyncResult } from "../whatsapp/templates";
import type { ChannelRecord } from "../types";
import { ycloudClientFor, YCloudNotConnectedError, type YCloudDeps } from "./config";

export const YCLOUD_TEMPLATES_SYNC_JOB = "yc.templates_sync";
export const ycloudTemplatesSyncPayload = z.object({ channelId: z.uuid() });
export const ycloudTemplatesSyncDedupeKey = (channelId: string) => `yc.templates_sync:${channelId}`;

export async function syncYCloudTemplates(channel: ChannelRecord, deps: YCloudDeps = {}): Promise<TemplatesSyncResult> {
  if (!channel.wabaId) throw new YCloudNotConnectedError();
  const templates = await ycloudClientFor(channel, deps).listTemplates(channel.wabaId);
  return storeWhatsAppTemplates(
    channel.id,
    templates.map((template) => ({
      id: template.officialTemplateId,
      name: template.name,
      language: template.language,
      category: template.category,
      status: template.status,
      components: template.components,
      rejectedReason: template.reason,
      ttlSeconds: template.messageSendTtlSeconds,
    })),
    deps.now?.() ?? new Date(),
  );
}
