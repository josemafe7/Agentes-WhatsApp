// «Nueva plantilla» ([WA-57]–[WA-59], [CUM-14]): what the person writes (name, language, category, header, body with the
// data that fills itself, footer, quick-reply buttons and time-to-live), the two models of the app, the warnings while
// writing a utility one, and what goes to Meta (named parameters) or to YCloud (numbered ones), each data with the
// example Meta asks for. Pure: the dialog and the server use the same checks. Limits from
// docs/integracion-whatsapp-plantillas.md §1–§3.
import type { TemplateButtonRole } from "./enums";

export const TEMPLATE_NAME_MAX = 512;
export const TEMPLATE_HEADER_MAX = 60;
export const TEMPLATE_BODY_MAX = 1_024;
export const TEMPLATE_FOOTER_MAX = 60;
export const TEMPLATE_BUTTON_MAX = 25;
export const TEMPLATE_BUTTONS_MAX = 10;
/** Utility templates: from 30 seconds to 12 hours ([WA-59]). */
export const TEMPLATE_TTL_MIN = 30;
export const TEMPLATE_TTL_MAX = 43_200;
export const MODEL_TTL_SECONDS = 3_600;

/** The data a template can fill on its own ([WA-57]): its variable in the text, what it is and Meta's example. */
export const TEMPLATE_FIELDS = [
  { key: "contact.name", variable: "nombre", label: "Nombre del contacto", example: "Laura" },
  { key: "service.name", variable: "servicio", label: "Servicio", example: "Sesión de fisioterapia" },
  { key: "booking.date", variable: "dia", label: "Día de la cita", example: "jueves 3 de octubre" },
  { key: "booking.time", variable: "hora", label: "Hora de la cita", example: "10:30" },
  { key: "resource.name", variable: "profesional", label: "Profesional", example: "Álvaro" },
  { key: "business.name", variable: "negocio", label: "Nombre del negocio", example: "" },
] as const;
export type TemplateFieldKey = (typeof TEMPLATE_FIELDS)[number]["key"];

const FIELD_BY_VARIABLE = new Map<string, (typeof TEMPLATE_FIELDS)[number]>(TEMPLATE_FIELDS.map((field) => [field.variable, field]));
const VARIABLE = /\{\{\s*([A-Za-z0-9_]{1,60})\s*\}\}/g;

export type TemplateCategory = "UTILITY" | "MARKETING";

export type TemplateDraft = {
  name: string;
  language: string;
  category: TemplateCategory;
  header: string;
  body: string;
  footer: string;
  buttons: { text: string; role: TemplateButtonRole | null }[];
  /** Null: Meta's own (30 days). Only utility templates have one of their own here. */
  ttlSeconds: number | null;
};

export type TemplateModel = { id: "reminder" | "marketing"; label: string; draft: TemplateDraft };

/**
 * The two models ([WA-59]): «Recordatorio de cita» (utility, only the data of the booking, «Confirmo» and «Necesito
 * cambiarla», 1 hour) — without the service in the sectors with health data ([CUM-14]) — and «Novedades y publicidad»
 * (marketing, the business's name and «No quiero publicidad»). Labels without accents: Meta only promises letters and
 * numbers on a button (§5).
 */
export function templateModels(options: { healthData: boolean; language?: string }): TemplateModel[] {
  const language = options.language ?? "es_ES";
  const service = options.healthData ? "" : " de {{servicio}}";
  return [
    {
      id: "reminder",
      label: "Recordatorio de cita",
      draft: {
        name: "recordatorio_cita",
        language,
        category: "UTILITY",
        header: "Recordatorio de tu cita",
        body: `Hola {{nombre}}, te recordamos tu cita${service} el {{dia}} a las {{hora}} con {{profesional}} en {{negocio}}. Si no puedes venir, avísanos.`,
        footer: "Responde con uno de los botones",
        buttons: [
          { text: "Confirmo", role: "confirm" },
          { text: "Necesito cambiarla", role: "change" },
        ],
        ttlSeconds: MODEL_TTL_SECONDS,
      },
    },
    {
      id: "marketing",
      label: "Novedades y publicidad",
      draft: {
        name: "novedades_y_publicidad",
        language,
        category: "MARKETING",
        header: "",
        body: "Hola, te escribimos desde {{negocio}} para contarte nuestras novedades. Si no quieres recibir más, pulsa el botón.",
        footer: "",
        buttons: [{ text: "No quiero publicidad", role: "marketing_opt_out" }],
        ttlSeconds: null,
      },
    },
  ];
}

export function variablesOf(text: string): string[] {
  return [...new Set([...text.matchAll(VARIABLE)].map((match) => match[1]))];
}

export type DraftErrors = Partial<Record<"name" | "language" | "header" | "body" | "footer" | "buttons" | "ttlSeconds", string>>;

/** What Meta would refuse, in Spanish, by field; empty when it may be sent. */
export function draftErrors(draft: TemplateDraft): DraftErrors {
  const errors: DraftErrors = {};
  if (!/^[a-z0-9_]+$/.test(draft.name) || draft.name.length > TEMPLATE_NAME_MAX) errors.name = "Solo minúsculas, números y guiones bajos (_), sin espacios.";
  if (!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(draft.language)) errors.language = "Elige un idioma.";
  const unknownIn = (text: string) => variablesOf(text).find((name) => !FIELD_BY_VARIABLE.has(name));
  const body = draft.body.trim();
  if (!body) errors.body = "Escribe el texto.";
  else if (body.length > TEMPLATE_BODY_MAX) errors.body = `Como mucho ${TEMPLATE_BODY_MAX} caracteres.`;
  else if (unknownIn(body)) errors.body = `«{{${unknownIn(body)}}}» no es un dato que se rellene solo.`;
  else if (/^\{\{/.test(body) || /\}\}$/.test(body)) errors.body = "El texto no puede empezar ni terminar con un dato: Meta la rechazaría.";
  else if (/\}\}\s*\{\{/.test(body)) errors.body = "Entre dos datos tiene que haber texto.";
  const header = draft.header.trim();
  if (header.length > TEMPLATE_HEADER_MAX) errors.header = `Como mucho ${TEMPLATE_HEADER_MAX} caracteres.`;
  else if (variablesOf(header).length > 1) errors.header = "El encabezado admite un solo dato.";
  else if (unknownIn(header)) errors.header = `«{{${unknownIn(header)}}}» no es un dato que se rellene solo.`;
  const footer = draft.footer.trim();
  if (footer.length > TEMPLATE_FOOTER_MAX) errors.footer = `Como mucho ${TEMPLATE_FOOTER_MAX} caracteres.`;
  else if (variablesOf(footer).length) errors.footer = "El pie no admite datos.";
  const labels = draft.buttons.map((button) => button.text.trim());
  if (labels.length > TEMPLATE_BUTTONS_MAX) errors.buttons = `Como mucho ${TEMPLATE_BUTTONS_MAX} botones.`;
  else if (labels.some((label) => !label || label.length > TEMPLATE_BUTTON_MAX)) errors.buttons = `Cada botón, de 1 a ${TEMPLATE_BUTTON_MAX} caracteres.`;
  else if (new Set(labels).size !== labels.length) errors.buttons = "Dos botones no pueden decir lo mismo.";
  if (draft.ttlSeconds !== null) {
    if (draft.category !== "UTILITY") errors.ttlSeconds = "Solo las plantillas de utilidad llevan caducidad propia.";
    else if (!Number.isInteger(draft.ttlSeconds) || draft.ttlSeconds < TEMPLATE_TTL_MIN || draft.ttlSeconds > TEMPLATE_TTL_MAX)
      errors.ttlSeconds = "De 30 segundos a 12 horas.";
  }
  return errors;
}

const OFFER = /\b(oferta|descuento|promoci[oó]n|rebaja|gratis|regalo|\d+\s?%|black friday|2x1|cup[oó]n|c[oó]digo promocional)\b/i;
const INVITE = /\b(reserva(?:\s+ya)?|reserve|pide (?:tu )?cita|ven a|no te pierdas|aprovecha|descubre|te recomendamos|prueba nuestr[oa]s?|nuev[oa]s? servicios?)\b/i;
const HEALTH = /\b(dolor|lesi[oó]n|lumbalgia|cervicalgia|contractura|tendinitis|esguince|fractura|diagn[oó]stico|s[ií]ntoma|enfermedad|tratamiento|punci[oó]n|rehabilitaci[oó]n|operaci[oó]n|embarazo|ansiedad|depresi[oó]n)\b/i;
const BOOKING_VARIABLES = new Set(["dia", "hora", "servicio", "profesional"]);

/**
 * What makes Meta move a utility template to marketing, and in health sectors what reveals health data ([WA-59],
 * [CUM-14]): warnings, never errors.
 */
export function utilityWarnings(draft: Pick<TemplateDraft, "category" | "header" | "body" | "footer">, options: { healthData: boolean }): string[] {
  if (draft.category !== "UTILITY") return [];
  const text = [draft.header, draft.body, draft.footer].join("\n");
  const warnings: string[] = [];
  if (OFFER.test(text)) warnings.push("Habla de ofertas o descuentos: Meta la pasará a marketing.");
  if (INVITE.test(text)) warnings.push("Invita a reservar o recomienda otro servicio: Meta la pasará a marketing.");
  const variables = variablesOf(text);
  if (!variables.some((name) => BOOKING_VARIABLES.has(name))) warnings.push("No habla de una cita concreta del cliente: un texto igual para todos es marketing para Meta.");
  const fixed = text.replace(VARIABLE, "").replace(/\s+/g, " ").trim();
  if (variables.length > 0 && fixed.length < variables.length * 12) warnings.push("Es casi solo datos que se rellenan: Meta puede rechazarla o pasarla a marketing.");
  if (options.healthData) {
    if (variables.includes("servicio")) warnings.push("El servicio puede revelar el tratamiento: en los sectores de salud, mejor sin él.");
    if (HEALTH.test(text)) warnings.push("No pongas síntomas, enfermedades ni tratamientos: son datos de salud.");
  }
  return warnings;
}

/** Variable → the data that fills it, for the variables of the text ([WA-58]). */
export function draftBindings(draft: Pick<TemplateDraft, "header" | "body">): Record<string, TemplateFieldKey> {
  const bindings: Record<string, TemplateFieldKey> = {};
  for (const name of variablesOf(`${draft.header}\n${draft.body}`)) {
    const field = FIELD_BY_VARIABLE.get(name);
    if (field) bindings[name] = field.key;
  }
  return bindings;
}

function exampleOf(variable: string, businessName: string): string {
  const field = FIELD_BY_VARIABLE.get(variable);
  return field?.key === "business.name" ? businessName || "Nuestro negocio" : (field?.example ?? variable);
}

export type BuiltTemplate = {
  /** The body for Meta or YCloud. */
  request: Record<string, unknown>;
  /** The components as they will come back when synced (Meta's shape), to store the row before the next sync. */
  components: Record<string, unknown>[];
  parameterFormat: "NAMED" | "POSITIONAL";
  /** Variable (name or number) → the data that fills it. */
  bindings: Record<string, TemplateFieldKey>;
  buttonRoles: Record<string, TemplateButtonRole>;
};

/**
 * The request: with Meta, named parameters (`{{nombre}}`) with `*_named_params` examples; with YCloud, whose API has no
 * named ones, the same text numbered in order of appearance (`{{1}}`…) with `body_text` examples (§1, §2).
 */
export function buildTemplateRequest(draft: TemplateDraft, options: { provider: "meta" | "ycloud"; businessName: string; wabaId?: string }): BuiltTemplate {
  const named = options.provider === "meta";
  const order = variablesOf(`${draft.header}\n${draft.body}`);
  const numberOf = new Map(order.map((name, index) => [name, String(index + 1)]));
  const rename = (text: string) => (named ? text : text.replace(VARIABLE, (_whole, name: string) => `{{${numberOf.get(name) ?? name}}}`));
  const header = draft.header.trim();
  const footer = draft.footer.trim();
  const components: Record<string, unknown>[] = [];
  if (header) {
    const [variable] = variablesOf(header);
    const example = variable
      ? named
        ? { header_text_named_params: [{ param_name: variable, example: exampleOf(variable, options.businessName) }] }
        : { header_text: [exampleOf(variable, options.businessName)] }
      : null;
    components.push({ type: "HEADER", format: "TEXT", text: rename(header), ...(example ? { example } : {}) });
  }
  const bodyVariables = variablesOf(draft.body);
  const bodyExample = bodyVariables.length
    ? named
      ? { body_text_named_params: bodyVariables.map((name) => ({ param_name: name, example: exampleOf(name, options.businessName) })) }
      : { body_text: [bodyVariables.map((name) => exampleOf(name, options.businessName))] }
    : null;
  components.push({ type: "BODY", text: rename(draft.body.trim()), ...(bodyExample ? { example: bodyExample } : {}) });
  if (footer) components.push({ type: "FOOTER", text: footer });
  if (draft.buttons.length) components.push({ type: "BUTTONS", buttons: draft.buttons.map((button) => ({ type: "QUICK_REPLY", text: button.text.trim() })) });

  const bindings: Record<string, TemplateFieldKey> = {};
  for (const [name, key] of Object.entries(draftBindings(draft))) bindings[named ? name : (numberOf.get(name) ?? name)] = key;
  const buttonRoles: Record<string, TemplateButtonRole> = {};
  for (const button of draft.buttons) if (button.role) buttonRoles[button.text.trim()] = button.role;

  const common = { name: draft.name, language: draft.language, category: draft.category, components };
  const request: Record<string, unknown> = named
    ? { ...common, parameter_format: "NAMED", ...(draft.ttlSeconds !== null ? { message_send_ttl_seconds: draft.ttlSeconds } : {}) }
    : { wabaId: options.wabaId, ...common, ...(draft.ttlSeconds !== null ? { messageSendTtlSeconds: draft.ttlSeconds } : {}) };
  return { request, components, parameterFormat: named ? "NAMED" : "POSITIONAL", bindings, buttonRoles };
}

/** The quick-reply buttons of a template's components, in order (for choosing what each one does). */
export function quickReplyButtons(components: readonly unknown[]): string[] {
  const labels: string[] = [];
  for (const component of components) {
    if (typeof component !== "object" || component === null) continue;
    const { type, buttons } = component as { type?: unknown; buttons?: unknown };
    if (String(type).toUpperCase() !== "BUTTONS" || !Array.isArray(buttons)) continue;
    for (const button of buttons) {
      const { type: kind, text } = (button ?? {}) as { type?: unknown; text?: unknown };
      if (String(kind).toUpperCase() === "QUICK_REPLY" && typeof text === "string") labels.push(text);
    }
  }
  return labels;
}
