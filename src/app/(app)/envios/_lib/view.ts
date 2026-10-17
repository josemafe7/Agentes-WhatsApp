// Addresses and words of Envíos ([ENV-01], [ENV-02], [ENV-12]). The contacts of a new envío travel in the address: the
// ones marked in Contactos (?contactos=id,id) or all of a filter (?etiqueta=…&canal=…); src/data/campaigns.ts validates
// them with Zod ([SEG-05]).
import type { CampaignRecipientStatus, CampaignStatus } from "@/lib/enums";

export const CAMPAIGNS_PATH = "/envios";
export const NEW_CAMPAIGN_PATH = `${CAMPAIGNS_PATH}/nuevo`;

/** The list of envíos, at a page. */
export function campaignsPath(page = 1): string {
  return page > 1 ? `${CAMPAIGNS_PATH}?pagina=${page}` : CAMPAIGNS_PATH;
}

export function campaignPath(campaignId: string, page = 1): string {
  return page > 1 ? `${CAMPAIGNS_PATH}/${campaignId}?pagina=${page}` : `${CAMPAIGNS_PATH}/${campaignId}`;
}

export function editCampaignPath(campaignId: string): string {
  return `${CAMPAIGNS_PATH}/${campaignId}/editar`;
}

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  scheduled: "Programado",
  sending: "Enviando",
  paused: "En pausa",
  finished: "Terminado",
  cancelled: "Cancelado",
};

export const RECIPIENT_STATUS_LABELS: Record<CampaignRecipientStatus, string> = {
  pending: "Pendiente",
  sending: "Enviando",
  sent: "Enviado",
  delivered: "Entregado",
  read: "Leído",
  failed: "Fallido",
  not_sent: "No enviado",
};

/** Who an envío goes to: the contacts marked, or all of a filter (label and channel; without them, everyone). */
export type CampaignAudience = { ids: string[] } | { filter: { label?: string; channelId?: string } };

type SearchParams = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined): string | undefined {
  const text = Array.isArray(value) ? value[0] : value;
  const trimmed = text?.trim();
  return trimmed ? trimmed : undefined;
}

export function audienceFromSearchParams(params: SearchParams): CampaignAudience {
  const ids = single(params.contactos)
    ?.split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (ids?.length) return { ids: [...new Set(ids)] };
  const label = single(params.etiqueta);
  const channelId = single(params.canal);
  return { filter: { ...(label ? { label } : {}), ...(channelId ? { channelId } : {}) } };
}

/** «Programar envío» for these contacts. */
export function newCampaignHref(audience: CampaignAudience): string {
  const params = new URLSearchParams();
  if ("ids" in audience) params.set("contactos", audience.ids.join(","));
  else {
    if (audience.filter.label) params.set("etiqueta", audience.filter.label);
    if (audience.filter.channelId) params.set("canal", audience.filter.channelId);
  }
  const search = params.toString();
  return search ? `${NEW_CAMPAIGN_PATH}?${search}` : NEW_CAMPAIGN_PATH;
}

/** The page of the results, from the address; anything else is the first one. */
export function resultsPageFromSearchParams(params: SearchParams): number {
  const page = Number(single(params.pagina));
  return Number.isInteger(page) && page >= 1 ? page : 1;
}
