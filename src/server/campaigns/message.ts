// The message of an envío for each contact ([ENV-04]): the texts take the contact's name and the business's ({nombre},
// {negocio}); a WhatsApp template gets, for each of its variables, one of those or a fixed text for this envío. The
// email carries the business's name and contact data at the foot and «Darme de baja» ([ENV-11]). Pure.
import "server-only";
import type { CampaignFieldKey, CampaignVariable } from "@/lib/campaigns";

export type CampaignValues = { contactName: string | null; businessName: string };

const FALLBACK_NAME = "";

function valueOf(field: CampaignFieldKey, values: CampaignValues): string {
  return field === "contact.name" ? (values.contactName?.trim() || FALLBACK_NAME) : values.businessName;
}

/** {nombre} and {negocio} replaced; a contact without a name leaves «Hola, » as «Hola». */
export function renderCampaignText(text: string, values: CampaignValues): string {
  const rendered = text.replaceAll("{nombre}", valueOf("contact.name", values)).replaceAll("{negocio}", values.businessName);
  return rendered.replace(/ ,/g, ",").replace(/\s+([,.!?])/g, "$1").replace(/[ \t]{2,}/g, " ").trim();
}

/** The values of a template's variables for this contact; a variable without a value gets a hyphen (Meta refuses empty). */
export function templateValuesFor(variables: Record<string, CampaignVariable>, values: CampaignValues): Record<string, string> {
  return Object.fromEntries(
    Object.entries(variables).map(([name, variable]) => {
      const value = "text" in variable ? variable.text.trim() : valueOf(variable.field, values);
      return [name, value || "-"];
    }),
  );
}

export type BusinessFooter = { name: string; contactEmail: string | null; phone: string | null; address: string | null };

/** The foot of an envío's email: who sends it and how to stop it ([ENV-04], [ENV-11], [CUM-15]). */
export function campaignEmailFooter(business: BusinessFooter, unsubscribeUrl: string): string {
  const contact = [business.address, business.phone, business.contactEmail].filter(Boolean).join(" · ");
  const lines = ["—", business.name, ...(contact ? [contact] : []), "", `¿No quieres recibir más novedades ni publicidad de ${business.name}? Darme de baja: ${unsubscribeUrl}`];
  return lines.join("\n");
}
