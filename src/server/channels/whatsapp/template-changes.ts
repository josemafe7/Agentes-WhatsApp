// What happened to a template that the owner and the admins must hear about ([WA-60], [AJU-08]): Meta rejected it,
// approved or moved it to another category, or announced it will. Told in Spanish with its reason (Meta's own words
// are data and stay out). A utility template moved to marketing no longer serves the reminders ([AGD-24]).
import "server-only";
import { notify } from "@/server/notifications/notify";

export type TemplateChange =
  | { kind: "rejected"; channelId: string; name: string; reason: string | null }
  | { kind: "category_changed"; channelId: string; name: string; from: string | null; to: string }
  | { kind: "category_announced"; channelId: string; name: string; to: string; at: Date | null };

const CATEGORY_NAMES: Record<string, string> = { UTILITY: "utilidad", MARKETING: "marketing", AUTHENTICATION: "autenticación" };

export function templateCategoryName(category: string | null | undefined): string {
  return category ? (CATEGORY_NAMES[category.toUpperCase()] ?? category.toLowerCase()) : "sin categoría";
}

/** Meta's `reason` of a rejection, in Spanish (docs/integracion-whatsapp-plantillas.md §4). */
export function rejectionReasonText(reason: string | null | undefined): string {
  switch (reason?.toUpperCase()) {
    case "INCORRECT_CATEGORY":
    case "TAG_CONTENT_MISMATCH":
      return "El texto no encaja con la categoría pedida.";
    case "INVALID_FORMAT":
      return "El formato no es válido.";
    case "ABUSIVE_CONTENT":
    case "PROMOTIONAL":
    case "SCAM":
      return "Meta considera que incumple sus políticas.";
    default:
      return "Meta la ha rechazado.";
  }
}

function messageOf(change: TemplateChange, timezone: string): { title: string; body: string } {
  switch (change.kind) {
    case "rejected":
      return { title: `Meta ha rechazado la plantilla «${change.name}»`, body: rejectionReasonText(change.reason) };
    case "category_changed": {
      const toMarketing = change.to.toUpperCase() === "MARKETING";
      return {
        title: `La plantilla «${change.name}» es ahora de ${templateCategoryName(change.to)}`,
        body: `Antes era de ${templateCategoryName(change.from)}.${toMarketing ? " Ya no sirve para los recordatorios: salen por el siguiente canal marcado hasta que elijas otra." : ""}`,
      };
    }
    case "category_announced": {
      const when = change.at ? ` el ${new Intl.DateTimeFormat("es-ES", { timeZone: timezone, day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(change.at)}` : "";
      return { title: `Meta cambiará la plantilla «${change.name}» a ${templateCategoryName(change.to)}${when}`, body: "Revisa si sigue sirviendo para lo que la usas." };
    }
  }
}

export async function notifyTemplateChanges(changes: readonly TemplateChange[], options: { timezone?: string } = {}): Promise<void> {
  for (const change of changes) {
    const { title, body } = messageOf(change, options.timezone ?? "Europe/Madrid");
    await notify({ event: "whatsapp_template", title, body, link: `/canales/${change.channelId}`, channelId: change.channelId });
  }
}
