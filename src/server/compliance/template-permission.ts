// Whether a WhatsApp template may go to a contact ([WA-61], [YC-11], [ENV-06], [ENV-14]): a utility one needs «Avisos de
// sus citas»; a marketing one, «Novedades y publicidad», no baja of it by WhatsApp and a baja button; no template goes
// to whoever opted out of WhatsApp, nor to a contact of the demo or the simulator through a channel that is not a demo
// one. The app checks it itself before each template, since YCloud's direct send does not look at its own list. Meta
// asks for the customer's permission before any template and does not say that having written counts as one.
import "server-only";
import { and, eq, like } from "drizzle-orm";
import { db, type Executor } from "@/db";
import { contactIdentities, contacts } from "@/db/schema";
import { blockReason } from "@/lib/consents";
import type { ContactPermission, TemplateButtonRole } from "@/lib/enums";
import { loadConsentState } from "./consent-state";

const SIMULATED_PREFIX = "sim:";

export type TemplateBlock = {
  code: "opted_out" | "marketing_opted_out" | "no_reminders_permission" | "no_marketing_permission" | "no_opt_out_button" | "not_allowed_category" | "demo_contact";
  message: string;
  /** The permission that, once recorded, lets it go. */
  permission?: ContactPermission;
};

/** Created by the demo or by the simulator (an identity «sim:…»): never reached through a real channel ([ENV-14]). */
export async function isDemoOrSimulatedContact(contactId: string, executor: Executor = db): Promise<boolean> {
  const [contact] = await executor.select({ isDemo: contacts.isDemo }).from(contacts).where(eq(contacts.id, contactId));
  if (contact?.isDemo) return true;
  const [simulated] = await executor
    .select({ id: contactIdentities.id })
    .from(contactIdentities)
    .where(and(eq(contactIdentities.contactId, contactId), like(contactIdentities.externalId, `${SIMULATED_PREFIX}%`)))
    .limit(1);
  return Boolean(simulated);
}

export const TEMPLATE_BLOCK_TEXT = {
  opted_out: "Este cliente se ha dado de baja en este canal: no se le pueden enviar plantillas.",
  marketing_opted_out: "Este cliente se ha dado de baja de novedades y publicidad por WhatsApp: no se le pueden enviar plantillas de marketing.",
  no_reminders_permission: "Este cliente dijo que no quiere «Avisos de sus citas»: vuelve a anotarlo solo si te lo pide, diciendo cómo.",
  no_marketing_permission: "Falta el permiso «Novedades y publicidad» del cliente: anótalo antes, diciendo cómo lo dio.",
  no_opt_out_button: "Esta plantilla de marketing no tiene un botón de baja: elige cuál lo es en el panel del número o usa otra.",
  not_allowed_category: "Solo se envían plantillas de utilidad o de marketing.",
  demo_contact: "Es un contacto de la demo o del simulador: no recibe nada por un canal real.",
} as const;

/** Why this template may not go to this contact, or null. */
export async function templateBlock(
  input: { contactId: string; channelIsDemo: boolean; template: { category: string | null; buttonRoles: Record<string, TemplateButtonRole> } },
  executor: Executor = db,
): Promise<TemplateBlock | null> {
  const category = input.template.category?.toUpperCase();
  const purpose = category === "UTILITY" ? "reminder" : category === "MARKETING" ? "marketing" : null;
  if (!purpose) return { code: "not_allowed_category", message: TEMPLATE_BLOCK_TEXT.not_allowed_category };
  if (!input.channelIsDemo && (await isDemoOrSimulatedContact(input.contactId, executor))) return { code: "demo_contact", message: TEMPLATE_BLOCK_TEXT.demo_contact };
  const reason = blockReason(await loadConsentState(input.contactId, executor), "whatsapp", purpose);
  if (reason) {
    const permission = reason === "no_reminders_permission" ? "reminders" : reason === "no_marketing_permission" ? "marketing" : undefined;
    return { code: reason, message: TEMPLATE_BLOCK_TEXT[reason], ...(permission ? { permission } : {}) };
  }
  if (purpose === "marketing" && !Object.values(input.template.buttonRoles).includes("marketing_opt_out")) {
    return { code: "no_opt_out_button", message: TEMPLATE_BLOCK_TEXT.no_opt_out_button };
  }
  return null;
}
