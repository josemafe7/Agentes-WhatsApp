// Custom HTTP tools ([HER-11]–[HER-14]): what a tool is made of, the rules to save it and the request of each call.
// Pure (Zod only, no server imports): the screens use its limits and labels, the data layer (src/data/custom-tools.ts)
// validates with it and the executor (./http-tool.ts) builds every call with it. The network rules (public addresses
// only, checked again when connecting) live in the executor.
import { z } from "zod";
import { isSystemToolName } from "@/lib/agent-tools";
import { HTTP_METHODS, type HttpMethod } from "@/lib/enums";

export const HTTP_TOOL_PARAM_TYPES = ["string", "number", "boolean", "enum"] as const;
export type HttpToolParamType = (typeof HTTP_TOOL_PARAM_TYPES)[number];

export const HTTP_TOOL_PARAM_TYPE_LABELS: Record<HttpToolParamType, string> = {
  string: "Texto",
  number: "Número",
  boolean: "Sí o no",
  enum: "Lista de opciones",
};

export const HTTP_TOOL_LIMITS = {
  nameMin: 3,
  nameMax: 64,
  descriptionMax: 1_000,
  parameters: 20,
  parameterNameMax: 64,
  parameterDescriptionMax: 500,
  options: 50,
  optionMax: 100,
  headers: 10,
  headerNameMax: 100,
  headerValueMax: 4_000,
  urlMax: 2_000,
  timeoutMinSeconds: 1,
  timeoutMaxSeconds: 30,
  defaultTimeoutSeconds: 10,
  /** Longest text the model may send in one parameter. */
  argumentMaxChars: 2_000,
} as const;

/** snake_case: what the model calls it (letters, digits and _ are also what OpenRouter accepts, ≤ 64). */
export const HTTP_TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
/** An HTTP header name (RFC 9110 «token»). */
const HEADER_NAME_PATTERN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
/** Visible ASCII and spaces: no line breaks (header injection) nor characters HTTP cannot carry. */
const HEADER_VALUE_PATTERN = /^[\x20-\x7E]*$/;
/** Headers the app sets itself (or that only make sense between machines of the same connection). */
const RESERVED_HEADERS: ReadonlySet<string> = new Set([
  "host",
  "content-length",
  "content-type",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "upgrade",
  "te",
  "trailer",
  "expect",
  "accept-encoding",
]);
/** «{numero_pedido}» in the address. */
const PLACEHOLDER = /\{([a-z][a-z0-9_]*)\}/g;
/** Only these ports outside local development, as src/server/web-fetch.ts ("" = the scheme's default). */
export const HTTP_TOOL_ALLOWED_PORTS: ReadonlySet<string> = new Set(["", "80", "443"]);
const FULL_ADDRESS = /^https?:\/\//i;

export type HttpToolParameter = {
  name: string;
  type: HttpToolParamType;
  /** For the model: what to put in it. May be empty. */
  description: string;
  required: boolean;
  /** Values of a list («enum»); empty for the other types. */
  options: string[];
};

// ─── Saving a tool ──────────────────────────────────────────────────────────────────────────────────────

const L = HTTP_TOOL_LIMITS;

/** «2.000»: Spanish thousands, also for four digits (Intl leaves «2000»). */
function thousands(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+$)/g, ".");
}

const parameterSchema = z
  .object({
    name: z
      .string({ error: "Escribe el nombre del dato." })
      .trim()
      .min(1, "Escribe el nombre del dato.")
      .max(L.parameterNameMax, `Como mucho ${L.parameterNameMax} caracteres.`)
      .regex(HTTP_TOOL_NAME_PATTERN, "Solo minúsculas sin tildes, números y _, empezando por una letra (p. ej. numero_pedido)."),
    type: z.enum(HTTP_TOOL_PARAM_TYPES, { error: "Elige el tipo del dato." }),
    description: z.string().trim().max(L.parameterDescriptionMax, `Como mucho ${L.parameterDescriptionMax} caracteres.`).default(""),
    required: z.boolean().default(false),
    options: z
      .array(z.string().trim().min(1, "Hay una opción vacía.").max(L.optionMax, `Cada opción, como mucho ${L.optionMax} caracteres.`))
      .max(L.options, `Como mucho ${L.options} opciones.`)
      .default([]),
  })
  .strict()
  .superRefine((parameter, ctx) => {
    if (parameter.type !== "enum") return;
    if (parameter.options.length === 0) ctx.addIssue({ code: "custom", path: ["options"], message: "Escribe al menos una opción." });
    if (new Set(parameter.options).size !== parameter.options.length) ctx.addIssue({ code: "custom", path: ["options"], message: "Hay opciones repetidas." });
  })
  .transform((parameter): HttpToolParameter => ({ ...parameter, options: parameter.type === "enum" ? parameter.options : [] }));

const headerSchema = z
  .object({
    name: z
      .string({ error: "Escribe el nombre de la cabecera." })
      .trim()
      .min(1, "Escribe el nombre de la cabecera.")
      .max(L.headerNameMax, `Como mucho ${L.headerNameMax} caracteres.`)
      .regex(HEADER_NAME_PATTERN, "Solo letras sin tildes, números y guiones (p. ej. X-Api-Key).")
      .refine((name) => !RESERVED_HEADERS.has(name.toLowerCase()), "Esa cabecera la pone la app: usa otra."),
    /** A new value. Empty or missing keeps the saved value of `keep`. Never sent back to the browser. */
    value: z
      .string()
      .trim()
      .max(L.headerValueMax, `Como mucho ${thousands(L.headerValueMax)} caracteres.`)
      .regex(HEADER_VALUE_PATTERN, "Solo caracteres visibles sin tildes ni ñ (sin saltos de línea).")
      .optional(),
    /** Name of the saved header whose value this row keeps («Cambiar» not pressed). */
    keep: z.string().max(L.headerNameMax).optional(),
  })
  .strict();

export const httpToolInputSchema = z
  .object({
    name: z
      .string({ error: "Escribe el nombre." })
      .trim()
      .toLowerCase()
      .min(L.nameMin, `Al menos ${L.nameMin} caracteres.`)
      .max(L.nameMax, `Como mucho ${L.nameMax} caracteres.`)
      .regex(HTTP_TOOL_NAME_PATTERN, "Solo minúsculas sin tildes, números y _, empezando por una letra (p. ej. consultar_pedido).")
      .refine((name) => !isSystemToolName(name), "Ese nombre es de una herramienta del sistema: elige otro."),
    description: z
      .string({ error: "Explica para qué sirve: la IA lo lee para decidir cuándo usarla." })
      .trim()
      .min(1, "Explica para qué sirve: la IA lo lee para decidir cuándo usarla.")
      .max(L.descriptionMax, `Como mucho ${thousands(L.descriptionMax)} caracteres.`),
    method: z.enum(HTTP_METHODS, { error: "Elige el método." }),
    url: z.string({ error: "Escribe la dirección." }).trim().min(1, "Escribe la dirección.").max(L.urlMax, "La dirección es demasiado larga."),
    timeoutSeconds: z
      .number({ error: "Escribe un número de segundos." })
      .int("Escribe un número entero de segundos.")
      .min(L.timeoutMinSeconds, `Como mínimo ${L.timeoutMinSeconds} segundo.`)
      .max(L.timeoutMaxSeconds, `Como máximo ${L.timeoutMaxSeconds} segundos.`),
    parameters: z.array(parameterSchema).max(L.parameters, `Como mucho ${L.parameters} datos.`).default([]),
    headers: z.array(headerSchema).max(L.headers, `Como mucho ${L.headers} cabeceras.`).default([]),
  })
  .strict()
  .superRefine((tool, ctx) => {
    const names = new Set<string>();
    tool.parameters.forEach((parameter, index) => {
      if (names.has(parameter.name)) ctx.addIssue({ code: "custom", path: ["parameters", index, "name"], message: "Ese nombre está repetido." });
      names.add(parameter.name);
    });
    const headers = new Set<string>();
    tool.headers.forEach((header, index) => {
      const key = header.name.toLowerCase();
      if (headers.has(key)) ctx.addIssue({ code: "custom", path: ["headers", index, "name"], message: "Esa cabecera está repetida." });
      headers.add(key);
    });
  });

export type HttpToolInput = z.output<typeof httpToolInputSchema>;

// ─── The address template ───────────────────────────────────────────────────────────────────────────────

/** Names inside {…} of an address, in order and once each. */
export function templatePlaceholders(template: string): string[] {
  return [...new Set(Array.from(template.matchAll(PLACEHOLDER), (match) => match[1]))];
}

function fillTemplate(template: string, value: (name: string) => string): string {
  return template.replace(PLACEHOLDER, (_match, name: string) => value(name));
}

/** The address with every placeholder filled with «x»: its scheme, server and port are those of every call. */
export function templateOrigin(template: string): URL | null {
  try {
    return new URL(fillTemplate(template, () => "x"));
  } catch {
    return null;
  }
}

/** What goes between «//» and the path: user, server and port. The URL parser takes «\» as «/». */
function authorityOf(template: string): string {
  const start = template.indexOf("//") + 2;
  let end = start;
  while (end < template.length && !"/\\?#".includes(template[end])) end += 1;
  return template.slice(start, end);
}

/**
 * Why an address template cannot be saved (Spanish, for the «Dirección» field); empty when it can. Data only in the
 * path or the query, never in the server: the model must never decide where the secret headers go. https only,
 * without user or password and on the usual ports, except in local development ([HER-14]). Whether the server is
 * public is checked by the executor (it needs the network rules of the server).
 */
export function urlTemplateProblems(template: string, parameters: readonly Pick<HttpToolParameter, "name" | "required">[], options: { allowLocal: boolean }): string[] {
  if (!FULL_ADDRESS.test(template)) return ["Escribe la dirección completa, empezando por https://."];
  const problems: string[] = [];
  const stripped = template.replace(PLACEHOLDER, "");
  if (stripped.includes("{") || stripped.includes("}")) {
    problems.push("Las llaves solo sirven para meter un dato en la dirección, así: {numero_pedido} (con el nombre de un dato de la herramienta).");
  }
  if (authorityOf(template).includes("{")) {
    problems.push("Los datos solo pueden ir en la ruta o en los parámetros de la dirección, nunca en el nombre del servidor.");
  }
  if (template.includes("#")) problems.push("La dirección no puede llevar «#».");
  for (const name of templatePlaceholders(template)) {
    const parameter = parameters.find((candidate) => candidate.name === name);
    if (!parameter) problems.push(`La dirección usa {${name}}, pero la herramienta no tiene ningún dato con ese nombre.`);
    else if (!parameter.required) problems.push(`{${name}} va en la dirección: márcalo como obligatorio.`);
  }
  const url = templateOrigin(template);
  if (!url || !url.hostname) return [...problems, "Escribe la dirección completa, empezando por https://."];
  const scheme = url.protocol === "https:" || (options.allowLocal && url.protocol === "http:");
  if (!scheme) problems.push("La dirección tiene que empezar por https://: las herramientas solo llaman a servicios con conexión segura.");
  if (url.username || url.password) problems.push("La dirección no puede llevar usuario ni contraseña: ponlos en una cabecera secreta.");
  if (!options.allowLocal && !HTTP_TOOL_ALLOWED_PORTS.has(url.port)) problems.push("Usa el puerto habitual de https (443): no se permiten otros puertos.");
  return problems;
}

// ─── Parameters for the model ───────────────────────────────────────────────────────────────────────────

/** How a tool's parameters are stored (custom_tools.parameters): the JSON Schema object the model reads. */
export function parametersToJsonSchema(parameters: readonly HttpToolParameter[]): Record<string, unknown> {
  const properties: Record<string, Record<string, unknown>> = {};
  for (const parameter of parameters) {
    const base: Record<string, unknown> = parameter.type === "enum" ? { type: "string", enum: [...parameter.options] } : { type: parameter.type };
    properties[parameter.name] = parameter.description ? { ...base, description: parameter.description } : base;
  }
  const required = parameters.filter((parameter) => parameter.required).map((parameter) => parameter.name);
  return { type: "object", properties, ...(required.length > 0 ? { required } : {}) };
}

const storedParametersSchema = z.object({
  type: z.literal("object").optional(),
  properties: z
    .record(
      z.string().regex(HTTP_TOOL_NAME_PATTERN),
      z.object({ type: z.enum(["string", "number", "boolean"]), description: z.string().optional(), enum: z.array(z.string()).min(1).optional() }),
    )
    .optional(),
  required: z.array(z.string()).optional(),
});

/** The parameters of a stored tool, or null when the stored value is not one this app wrote. */
export function parametersFromJsonSchema(value: unknown): HttpToolParameter[] | null {
  const parsed = storedParametersSchema.safeParse(value);
  if (!parsed.success) return null;
  const required = new Set(parsed.data.required ?? []);
  return Object.entries(parsed.data.properties ?? {}).map(([name, property]) => ({
    name,
    type: property.enum ? "enum" : property.type,
    description: property.description ?? "",
    required: required.has(name),
    options: property.enum ?? [],
  }));
}

/** «Falta este dato.» when the model left it out; `expected` when it sent something of another type. */
function typeError(expected: string) {
  return { error: (issue: { input?: unknown }) => (issue.input === undefined ? "Falta este dato." : expected) };
}

function argumentSchema(parameter: HttpToolParameter): z.ZodType {
  switch (parameter.type) {
    case "number":
      return z.number(typeError("Tiene que ser un número."));
    case "boolean":
      return z.boolean(typeError("Tiene que ser true o false."));
    case "enum": {
      const [first = "", ...rest] = parameter.options;
      const values: [string, ...string[]] = [first, ...rest];
      return z.enum(values, typeError(`Tiene que ser una de estas opciones: ${parameter.options.join(", ")}.`));
    }
    default:
      return z
        .string(typeError("Tiene que ser un texto."))
        .max(L.argumentMaxChars, `Como mucho ${thousands(L.argumentMaxChars)} caracteres.`);
  }
}

/**
 * The Zod schema the model's arguments are validated with before anything is called ([HER-02]); defineTool turns it
 * into the JSON Schema the model sees. Unknown keys are dropped, never sent.
 */
export function httpToolArgumentsSchema(parameters: readonly HttpToolParameter[]): z.ZodObject<Record<string, z.ZodType>> {
  const shape: Record<string, z.ZodType> = {};
  for (const parameter of parameters) {
    const schema = parameter.description ? argumentSchema(parameter).describe(parameter.description) : argumentSchema(parameter);
    shape[parameter.name] = parameter.required ? schema : schema.optional();
  }
  return z.object(shape);
}

// ─── One call ───────────────────────────────────────────────────────────────────────────────────────────

export type HttpToolPlan = { method: HttpMethod; url: string; body: string | null };

export type HttpToolPlanResult =
  | { ok: true; plan: HttpToolPlan }
  /** A value that cannot go in the address: empty, «.» or «..» (they would change the path). */
  | { ok: false; reason: "invalid_value"; parameter: string }
  | { ok: false; reason: "invalid_url" };

function argumentText(value: unknown): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : "";
}

/**
 * The request of one call with validated arguments: each value put in the address is URL-encoded, so it can never
 * change the server, the path or the query; the parameters not in the address go in the query (GET) or in a JSON body
 * (the other methods). Missing optional parameters are left out.
 */
export function planHttpToolCall(tool: { method: HttpMethod; url: string; parameters: readonly HttpToolParameter[] }, args: Record<string, unknown>): HttpToolPlanResult {
  const inAddress = templatePlaceholders(tool.url);
  for (const name of inAddress) {
    const text = argumentText(args[name]);
    if (text === "" || text === "." || text === "..") return { ok: false, reason: "invalid_value", parameter: name };
  }
  const expected = templateOrigin(tool.url);
  let url: URL;
  try {
    url = new URL(fillTemplate(tool.url, (name) => encodeURIComponent(argumentText(args[name]))));
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  // Defence in depth: the values never move the call to another server.
  if (!expected || url.origin !== expected.origin || url.username || url.password) return { ok: false, reason: "invalid_url" };
  url.hash = "";
  const others = tool.parameters.filter((parameter) => !inAddress.includes(parameter.name) && args[parameter.name] !== undefined);
  if (tool.method === "GET") {
    for (const parameter of others) url.searchParams.append(parameter.name, argumentText(args[parameter.name]));
    return { ok: true, plan: { method: tool.method, url: url.href, body: null } };
  }
  const body = JSON.stringify(Object.fromEntries(others.map((parameter) => [parameter.name, args[parameter.name]])));
  return { ok: true, plan: { method: tool.method, url: url.href, body } };
}
