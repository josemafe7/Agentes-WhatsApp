// WhatsApp templates ([WA-22], [WA-42], [WA-43], docs/integracion-whatsapp-mensajes.md §11.4): the variables of a
// synced template and the `template` object sent to Meta with its values. Pure, so the inbox and the reminders build
// the same thing. Named ({{nombre}}) and positional ({{1}}) parameters; media headers need a media id.
import { z } from "zod";

/** Stored on an outbound message (`messages.metadata.whatsappTemplate`); the adapter sends it as `template`. */
export type WhatsAppTemplateSend = {
  name: string;
  language: { code: string };
  components: { type: "header" | "body"; parameters: Record<string, unknown>[] }[];
};

export const TEMPLATE_METADATA_KEY = "whatsappTemplate";

const componentSchema = z.object({ type: z.string(), format: z.string().nullish(), text: z.string().nullish() });
type TemplateComponent = z.infer<typeof componentSchema>;
const VARIABLE = /\{\{\s*([A-Za-z0-9_]{1,60})\s*\}\}/g;
const MAX_VALUE = 1_024;
const MEDIA_FORMATS = new Set(["IMAGE", "VIDEO", "DOCUMENT"]);

export class TemplateBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateBuildError";
  }
}

function componentsOf(raw: readonly unknown[]): TemplateComponent[] {
  return raw.flatMap((entry) => {
    const parsed = componentSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

function variablesIn(text: string | null | undefined): string[] {
  const found = [...(text ?? "").matchAll(VARIABLE)].map((match) => match[1]);
  return [...new Set(found)];
}

const find = (components: TemplateComponent[], type: string) => components.find((component) => component.type.toUpperCase() === type);

/** Variables of the header (text only) and the body, in order of appearance (positional ones sorted by number). */
export function templateVariables(rawComponents: readonly unknown[]): { header: string[]; body: string[]; headerMedia: "image" | "video" | "document" | null } {
  const components = componentsOf(rawComponents);
  const header = find(components, "HEADER");
  const format = header?.format?.toUpperCase() ?? "TEXT";
  const sortPositional = (names: string[]) => (names.every((name) => /^\d+$/.test(name)) ? [...names].sort((a, b) => Number(a) - Number(b)) : names);
  return {
    header: header && format === "TEXT" ? sortPositional(variablesIn(header.text)) : [],
    body: sortPositional(variablesIn(find(components, "BODY")?.text)),
    headerMedia: header && MEDIA_FORMATS.has(format) ? (format.toLowerCase() as "image" | "video" | "document") : null,
  };
}

/** Every variable name the template needs, header first: what `whatsapp_templates.variables` stores. */
export function templateVariableNames(rawComponents: readonly unknown[]): string[] {
  const { header, body } = templateVariables(rawComponents);
  return [...new Set([...header, ...body])];
}

/** One line, trimmed: a value never breaks the template's layout. */
function cleanValue(name: string, values: Readonly<Record<string, string>>): string {
  const value = (values[name] ?? "").replace(/\s+/g, " ").trim();
  if (!value) throw new TemplateBuildError(`Falta el dato «${name}» de la plantilla.`);
  if (value.length > MAX_VALUE) throw new TemplateBuildError(`El dato «${name}» es demasiado largo.`);
  return value;
}

export type TemplateBuildInput = {
  name: string;
  language: string;
  /** Meta's parameter_format: NAMED or POSITIONAL (the default). */
  parameterFormat?: string | null;
  components: readonly unknown[];
  values: Readonly<Record<string, string>>;
  /** A header of image, video or document needs an uploaded media id. */
  headerMediaId?: string | null;
};

/** The `template` object for POST /messages, or TemplateBuildError with a Spanish message. */
export function buildTemplateSend(input: TemplateBuildInput): WhatsAppTemplateSend {
  const named = input.parameterFormat?.toUpperCase() === "NAMED";
  const vars = templateVariables(input.components);
  const parameter = (name: string) => ({ type: "text", ...(named ? { parameter_name: name } : {}), text: cleanValue(name, input.values) });
  const components: WhatsAppTemplateSend["components"] = [];
  if (vars.headerMedia) {
    if (!input.headerMediaId) throw new TemplateBuildError("La plantilla necesita un archivo en la cabecera.");
    components.push({ type: "header", parameters: [{ type: vars.headerMedia, [vars.headerMedia]: { id: input.headerMediaId } }] });
  } else if (vars.header.length > 0) {
    components.push({ type: "header", parameters: vars.header.map(parameter) });
  }
  if (vars.body.length > 0) components.push({ type: "body", parameters: vars.body.map(parameter) });
  return { name: input.name, language: { code: input.language }, components };
}

/** The body as the customer reads it, for the inbox (`messages.text`). */
export function renderTemplateText(rawComponents: readonly unknown[], values: Readonly<Record<string, string>>): string {
  const body = find(componentsOf(rawComponents), "BODY")?.text ?? "";
  return body.replace(VARIABLE, (_match, name: string) => (values[name] ?? "").replace(/\s+/g, " ").trim());
}

/** «es_ES» and «es-ES» are the same language (Meta's examples use both, docs §9). */
export function sameTemplateLanguage(a: string, b: string): boolean {
  return a.replace(/-/g, "_").toLowerCase() === b.replace(/-/g, "_").toLowerCase();
}
