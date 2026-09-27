// The form and preview of a WhatsApp template in the inbox ([WA-43], [BAN-08]). Pure, for the client: the fields come
// from the same variable reading as the server (src/lib/meta/templates.ts), and the server validates everything again
// when it builds what goes to Meta. Components are Meta's data: only the documented fields are read, as text.
import { z } from "zod";
import { templateVariables } from "@/lib/meta/templates";

/** Same limit as the server (src/lib/meta/templates.ts and templateMessageSchema). */
export const MAX_TEMPLATE_VALUE = 1_024;

export type TemplateField = { name: string; part: "header" | "body" };
export type TemplateForm = { fields: TemplateField[]; headerMedia: "image" | "video" | "document" | null };
export type TemplatePreview = { header: string | null; body: string; footer: string | null; buttons: string[] };

const componentSchema = z.object({
  type: z.string(),
  format: z.string().nullish(),
  text: z.string().nullish(),
  buttons: z.array(z.object({ text: z.string().nullish() })).nullish(),
});
type Component = z.infer<typeof componentSchema>;

const VARIABLE = /\{\{\s*([A-Za-z0-9_]{1,60})\s*\}\}/g;
const MISSING_VALUE = "Rellena este dato.";
const TOO_LONG = `Como mucho ${MAX_TEMPLATE_VALUE} caracteres.`;
const MEDIA_HEADER = "Esta plantilla lleva un archivo en la cabecera: no se puede enviar desde la bandeja.";

function componentsOf(raw: readonly unknown[]): Component[] {
  return raw.flatMap((entry) => {
    const parsed = componentSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

const find = (components: Component[], type: string) => components.find((component) => component.type.toUpperCase() === type);

/** One line, as the server sends it (a value never breaks the template's layout). */
const oneLine = (value: string | undefined) => (value ?? "").replace(/\s+/g, " ").trim();

/** One field per variable (asked once even if it appears twice), header first. */
export function templateForm(components: readonly unknown[]): TemplateForm {
  const { header, body, headerMedia } = templateVariables(components);
  const fields: TemplateField[] = header.map((name) => ({ name, part: "header" as const }));
  for (const name of body) if (!fields.some((field) => field.name === name)) fields.push({ name, part: "body" });
  return { fields, headerMedia };
}

/** What is wrong with the values, by field (`header` when the template cannot be sent from here). Empty = ready. */
export function templateValueErrors(form: TemplateForm, values: Readonly<Record<string, string>>): Record<string, string> {
  if (form.headerMedia) return { header: MEDIA_HEADER };
  const errors: Record<string, string> = {};
  for (const field of form.fields) {
    const value = oneLine(values[field.name]);
    if (!value) errors[field.name] = MISSING_VALUE;
    else if (value.length > MAX_TEMPLATE_VALUE) errors[field.name] = TOO_LONG;
  }
  return errors;
}

/** Only the template's own variables, on one line. */
export function templateValuesToSend(form: TemplateForm, values: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(form.fields.map((field) => [field.name, oneLine(values[field.name])]));
}

/** The message as the customer will read it; what is still empty keeps its {{variable}}. */
export function templatePreview(rawComponents: readonly unknown[], values: Readonly<Record<string, string>>): TemplatePreview {
  const components = componentsOf(rawComponents);
  const fill = (text: string) => text.replace(VARIABLE, (match, name: string) => oneLine(values[name]) || match);
  const header = find(components, "HEADER");
  const headerText = header && (header.format ?? "TEXT").toUpperCase() === "TEXT" && header.text ? fill(header.text) : null;
  const footer = find(components, "FOOTER")?.text ?? null;
  const buttons = (find(components, "BUTTONS")?.buttons ?? []).flatMap((button) => (button.text ? [button.text] : []));
  return { header: headerText, body: fill(find(components, "BODY")?.text ?? ""), footer, buttons };
}
