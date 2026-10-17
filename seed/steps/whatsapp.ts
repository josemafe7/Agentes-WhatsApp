// WhatsApp of the demo ([ARR-06], [ARR-11], [ARR-25], [WA-22], [WA-43], [WA-59], [AJU-09]):
// - the templates of the demo number: the two models of the app, approved as «Nueva plantilla» leaves them on a demo
//   channel — «Recordatorio de cita» (without the service in the sectors with health data, [CUM-14]) and «Novedades y
//   publicidad» with its baja button —, and as «Sincronizar plantillas» would leave the others: one more APPROVED (a
//   follow-up with a positional variable), one PENDING and one REJECTED. A conversation whose 24 h window is closed can
//   send an approved one from the inbox; being a demo channel, the DemoAdapter only stores it;
// - example per-message rates for Spain, flagged «ejemplo» ([AJU-09]): they are NOT Meta's prices (the app never has
//   prices in its code) but made-up round numbers so the demo shows an estimated cost. A business copies its own from
//   Meta's rate table in Ajustes › WhatsApp, which clears the flag.
import { pricingRates, whatsappTemplates } from "@/db/schema";
import type { WhatsAppPricingCategory } from "@/lib/meta/pricing";
import { templateVariableNames } from "@/lib/meta/templates";
import type { TemplateButtonRole } from "@/lib/enums";
import { buildTemplateRequest, templateModels } from "@/lib/whatsapp-template-draft";
import type { SectorPreset } from "@/lib/sectors";
import type { DemoBusiness } from "../businesses";
import type { SeedStep } from "../types";

export type DemoTemplatePlan = {
  name: string;
  language: string;
  category: "UTILITY" | "MARKETING";
  status: "APPROVED" | "PENDING" | "REJECTED";
  rejectedReason: string | null;
  /** As Meta returns them: HEADER, BODY and FOOTER, with their examples. */
  components: Record<string, unknown>[];
  /** The models of the app remember their data, buttons and time-to-live ([WA-58], [WA-59]). */
  model?: { bindings: Record<string, string>; buttonRoles: Record<string, TemplateButtonRole>; ttlSeconds: number | null };
};

/** Five templates in the business's words. Pure: the same business gives the same templates. */
export function buildDemoTemplates(business: DemoBusiness, preset: SectorPreset): DemoTemplatePlan[] {
  const booking = preset.terminology.booking.toLowerCase();
  const footer = { type: "FOOTER", text: business.name };
  return [
    ...templateModels({ healthData: preset.healthData, language: "es" }).map((model): DemoTemplatePlan => {
      const draft = model.id === "reminder" ? { ...model.draft, name: "recordatorio_cita", header: `Recordatorio de tu ${booking}` } : model.draft;
      const built = buildTemplateRequest(draft, { provider: "meta", businessName: business.name });
      return {
        name: draft.name,
        language: draft.language,
        category: draft.category,
        status: "APPROVED",
        rejectedReason: null,
        components: built.components,
        model: { bindings: built.bindings, buttonRoles: built.buttonRoles, ttlSeconds: draft.ttlSeconds },
      };
    }),
    {
      name: "retomar_conversacion",
      language: "es",
      category: "UTILITY",
      status: "APPROVED",
      rejectedReason: null,
      components: [
        {
          type: "BODY",
          text: `Hola, {{1}}. Te escribimos de ${business.name} por tu consulta. ¿Te podemos ayudar en algo más?`,
          example: { body_text: [["Laura"]] },
        },
        footer,
      ],
    },
    {
      name: "novedades_del_mes",
      language: "es",
      category: "MARKETING",
      status: "PENDING",
      rejectedReason: null,
      components: [
        { type: "BODY", text: `¡Hola, {{1}}! Este mes tenemos novedades en ${business.name}. Responde a este mensaje y te las contamos.`, example: { body_text: [["Laura"]] } },
        footer,
      ],
    },
    {
      name: "aviso_cierre",
      language: "es",
      category: "UTILITY",
      status: "REJECTED",
      rejectedReason: "INVALID_FORMAT",
      components: [{ type: "BODY", text: "{{1}}", example: { body_text: [["Cerramos el lunes por festivo."]] } }],
    },
  ];
}

/** Example rates of the demo's market (the demo contacts are Spanish numbers). Made-up values, never Meta's. */
export const DEMO_EXAMPLE_RATES: readonly { country: string; category: WhatsAppPricingCategory; price: number }[] = [
  { country: "ES", category: "service", price: 0.02 },
  { country: "ES", category: "utility", price: 0.02 },
  { country: "ES", category: "authentication", price: 0.02 },
  { country: "ES", category: "marketing", price: 0.06 },
];

export const whatsappStep: SeedStep = {
  name: "whatsapp",
  prepare: async (ctx) => async (tx) => {
    const channelId = ctx.refs.channelIds?.get("whatsapp");
    if (!channelId) throw new Error("Las plantillas de WhatsApp de la demo necesitan su canal: el paso de canales va antes.");
    await tx.insert(whatsappTemplates).values(
      buildDemoTemplates(ctx.business, ctx.preset).map((template) => ({
        channelId,
        metaTemplateId: null,
        name: template.name,
        language: template.language,
        category: template.category,
        status: template.status,
        components: template.components,
        variables: templateVariableNames(template.components),
        rejectedReason: template.rejectedReason,
        ...(template.model
          ? {
              createdInApp: true,
              requestedCategory: template.category,
              parameterFormat: "NAMED",
              variableBindings: template.model.bindings,
              buttonRoles: template.model.buttonRoles,
              ttlSeconds: template.model.ttlSeconds,
            }
          : {}),
        lastSyncedAt: ctx.now,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      })),
    );
    await tx.insert(pricingRates).values(
      DEMO_EXAMPLE_RATES.map((rate) => ({ channelType: "whatsapp" as const, ...rate, currency: "USD", isExample: true, createdAt: ctx.now, updatedAt: ctx.now })),
    );
  },
};
