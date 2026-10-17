// What the «Programar envío» form keeps and sends ([ENV-02]–[ENV-04]). Pure: the form and its tests share it; the
// server validates everything again (src/data/campaigns.ts).
import { CAMPAIGN_FIELDS, CAMPAIGN_ROUTES, type CampaignEmail, type CampaignFieldKey, type CampaignRoute, type CampaignTelegram, type CampaignVariable, type CampaignWhatsApp } from "@/lib/campaigns";
import type { CampaignAudience } from "./view";

export type CampaignFormState = {
  name: string;
  routes: CampaignRoute[];
  whatsapp: CampaignWhatsApp | null;
  telegram: CampaignTelegram | null;
  email: CampaignEmail | null;
  when: "now" | "later";
  /** Local day and time of the business, «2026-10-20T10:00». */
  at: string;
};

export function emptyCampaignForm(): CampaignFormState {
  return { name: "", routes: [], whatsapp: null, telegram: null, email: null, when: "now", at: "" };
}

/** What goes to the server: only the marked channels keep their message. */
export function campaignInput(state: CampaignFormState) {
  const routes = CAMPAIGN_ROUTES.filter((route) => state.routes.includes(route));
  return {
    name: state.name,
    routes,
    whatsapp: routes.includes("whatsapp") ? state.whatsapp : null,
    telegram: routes.includes("telegram") ? state.telegram : null,
    email: routes.includes("email") ? state.email : null,
    sendAt: state.when === "now" ? "now" : state.at,
  };
}

/** The audience of a new envío, or the contacts still waiting of the one being changed. */
export function previewInput(state: CampaignFormState, audience: CampaignAudience | { campaignId: string }) {
  return { ...campaignInput(state), audience };
}

const FIELD_KEYS = new Set<string>(CAMPAIGN_FIELDS.map((field) => field.key));

/**
 * The data of a template created from the app come already set when they are data an envío has (the contact's or the
 * business's name); the rest start empty, to choose a datum or write a fixed text ([WA-58]).
 */
export function variablesFromBindings(variables: readonly string[], bindings: Record<string, string>): Record<string, CampaignVariable> {
  const values: Record<string, CampaignVariable> = {};
  for (const variable of variables) {
    const binding = bindings[variable];
    values[variable] = binding && FIELD_KEYS.has(binding) ? { field: binding as CampaignFieldKey } : { text: "" };
  }
  return values;
}

/** «{{1}}» with what it will say, for the template's text shown next to the form. */
export function templatePreview(body: string, variables: Record<string, CampaignVariable>): string {
  return body.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (match, name: string) => {
    const value = variables[name];
    if (!value) return match;
    if ("field" in value) return `[${CAMPAIGN_FIELDS.find((field) => field.key === value.field)?.label ?? value.field}]`;
    return value.text.trim() || match;
  });
}
