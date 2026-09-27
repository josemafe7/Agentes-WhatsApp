// Channels of the demo ([ARR-06], [ARR-11], [CAN-01]–[CAN-08]): a real web chat (it works in /widget-demo) and a
// WhatsApp and an email channel marked «Demo», which never call Meta, Google, Microsoft or a mail server: what
// they receive comes from the simulator and what they «send» is only stored. Each one has an active agent from the
// agents step with the AI on, automatic replies (drafts in email, [CAN-07]) and test mode off. Later steps find
// them in ctx.refs.channelIds by key.
import { channels, type ChannelHealth } from "@/db/schema";
import type { ChannelType, ReplyMode } from "@/lib/enums";
import { webchatConfigSchema, type WebchatConfig } from "@/lib/webchat-config";
import type { DemoBusiness } from "../businesses";
import type { SeedStep } from "../types";
import type { DemoAgentKey } from "./agents";

export const DEMO_CHANNEL_KEYS = ["webchat", "whatsapp", "email"] as const;
export type DemoChannelKey = (typeof DEMO_CHANNEL_KEYS)[number];

/** The Graph API version new WhatsApp channels start with ([WA-49]). */
const GRAPH_API_VERSION = "v26.0";
/** The channels were connected before the demo's conversations started. */
const CONNECTED_DAYS_AGO = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

export type DemoChannelPlan = {
  key: DemoChannelKey;
  type: ChannelType;
  name: string;
  isDemo: boolean;
  agentKey: DemoAgentKey;
  replyMode: ReplyMode;
  config: Record<string, unknown>;
  /** WhatsApp number data shown in the channel card ([WA-26]). */
  whatsapp?: { displayPhoneNumber: string; verifiedName: string };
};

/** The web chat of the demo: voice notes and images on, so the widget shows everything ([WEB-07]). */
export function demoWebchatConfig(business: DemoBusiness): WebchatConfig {
  return webchatConfigSchema.parse({
    welcomeMessage: `¡Hola! Soy el asistente virtual de ${business.name}. ¿En qué te puedo ayudar?`,
    legalText: `Al escribirnos aceptas la política de privacidad de ${business.name}. Te atiende un asistente de inteligencia artificial y siempre puedes pedir que te atienda una persona.`,
    position: "right",
    // Empty: only inside the app, in /widget-demo ([WEB-10]).
    allowedDomains: [],
    voiceEnabled: true,
    imagesEnabled: true,
  });
}

/** The three demo channels. Pure: the same business gives the same channels. */
export function buildDemoChannels(business: DemoBusiness): DemoChannelPlan[] {
  return [
    { key: "webchat", type: "webchat", name: "Chat de la web", isDemo: false, agentKey: "recepcion", replyMode: "auto", config: demoWebchatConfig(business) },
    {
      key: "whatsapp",
      type: "whatsapp",
      name: "WhatsApp",
      isDemo: true,
      agentKey: "recepcion",
      replyMode: "auto",
      config: {},
      whatsapp: { displayPhoneNumber: business.contactPhone, verifiedName: business.name },
    },
    // Gmail as it is the most common mailbox of a small business; being a demo, it never talks to Google.
    { key: "email", type: "email_gmail", name: "Correo", isDemo: true, agentKey: "correo", replyMode: "draft", config: { emailAddress: business.contactEmail } },
  ];
}

function demoHealth(now: Date): ChannelHealth {
  return { checkedAt: now.toISOString(), checks: [{ key: "demo", status: "ok", detail: "Canal de demo: no se conecta a ningún servicio." }] };
}

export const channelsStep: SeedStep = {
  name: "canales",
  prepare: async (ctx) => async (tx) => {
    const agentIds = ctx.refs.agentIds;
    if (!agentIds) throw new Error("Los canales de la demo necesitan los agentes: el paso de agentes va antes.");
    const channelIds = new Map<string, string>();
    const connectedAt = new Date(ctx.now.getTime() - CONNECTED_DAYS_AGO * DAY_MS);
    for (const plan of buildDemoChannels(ctx.business)) {
      const [row] = await tx
        .insert(channels)
        .values({
          type: plan.type,
          name: plan.name,
          status: "connected",
          isDemo: plan.isDemo,
          config: plan.config,
          activeAgentId: agentIds.get(plan.agentKey) ?? null,
          aiEnabled: true,
          testMode: false,
          replyMode: plan.replyMode,
          offHoursBehavior: "reply",
          lastHealth: plan.isDemo ? demoHealth(ctx.now) : null,
          lastHealthAt: plan.isDemo ? ctx.now : null,
          ...(plan.whatsapp
            ? {
                connectionMode: "manual" as const,
                displayPhoneNumber: plan.whatsapp.displayPhoneNumber,
                verifiedName: plan.whatsapp.verifiedName,
                qualityRating: "GREEN",
                nameStatus: "APPROVED",
                messagingLimit: "TIER_250",
                graphApiVersion: GRAPH_API_VERSION,
              }
            : {}),
          createdAt: connectedAt,
          updatedAt: connectedAt,
        })
        .returning({ id: channels.id });
      channelIds.set(plan.key, row.id);
    }
    ctx.refs.channelIds = channelIds;
  },
};
