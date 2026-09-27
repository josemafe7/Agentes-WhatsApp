// The custom HTTP tools of the e2e run (fase 7 · [HER-11]–[HER-14]): a small shop API the tools created by the specs
// point to (<mock>/http-tools/…, allowed because the e2e app runs with ALLOW_LOCAL_HTTP_TOOLS=true), and the step of
// the simulated model that calls them. Plain Node, no dependencies.
//
//   GET  /pedidos/:numero   { pedido, estado: "En reparto", entrega } (404 { error } for the order «404»); 401 without
//                           an X-Api-Key header (its value is checked by the specs in the recorded requests).
//   POST /tickets           201 { ticket: "T-1001", estado: "abierto" }, the same 401 without X-Api-Key.
//
// The model (httpToolStep, used by ./openrouter.mjs): when the customer's last message names a tool it was offered that
// is not a system tool, it calls it with the «nombre=valor» pairs written in the message (other required parameters get
// a sample value); after the tool's answer it replies, after the usual intro, «Resultado de <herramienta>: <answer>».

const SYSTEM_TOOLS = new Set([
  "buscar_conocimiento",
  "listar_servicios",
  "consultar_disponibilidad",
  "crear_cita",
  "ver_citas_del_cliente",
  "cancelar_cita",
  "reprogramar_cita",
  "guardar_datos_contacto",
  "transferir_a_humano",
]);

function unauthorized(headers) {
  return headers["x-api-key"] ? null : { status: 401, body: { error: "Falta la clave de la API." } };
}

/** @type {import("../server.mjs").MockRoute[]} */
export const httpToolRoutes = [
  {
    method: "GET",
    path: "/pedidos/:numero",
    handle: ({ path, headers }) => {
      const denied = unauthorized(headers);
      if (denied) return denied;
      const numero = decodeURIComponent(path.split("/").at(-1) ?? "");
      if (numero === "404") return { status: 404, body: { error: "Pedido no encontrado" } };
      return { body: { pedido: numero, estado: "En reparto", entrega: "mañana por la mañana" } };
    },
  },
  {
    method: "POST",
    path: "/tickets",
    handle: ({ headers }) => unauthorized(headers) ?? { status: 201, body: { ticket: "T-1001", estado: "abierto" } },
  },
];

// ─── The simulated model ────────────────────────────────────────────────────────────────────────────────

/** «numero=42» or «nota="llamar luego"» pairs of a message. */
function givenValues(text) {
  const values = {};
  for (const match of text.matchAll(/([a-z][a-z0-9_]*)=("[^"]*"|[^\s,;]+)/g)) values[match[1]] = match[2].replace(/^"|"$/g, "");
  return values;
}

function valueFor(property, raw) {
  if (Array.isArray(property?.enum)) return raw !== undefined && property.enum.includes(raw) ? raw : property.enum[0];
  if (property?.type === "number" || property?.type === "integer") return raw !== undefined && Number.isFinite(Number(raw)) ? Number(raw) : 1;
  if (property?.type === "boolean") return raw === undefined ? true : raw === "true";
  return raw ?? "ejemplo";
}

/** Arguments for a tool's JSON Schema: the values written in the message, and a sample for the other required ones. */
function argumentsFor(schema, text) {
  const given = givenValues(text);
  const required = new Set(Array.isArray(schema?.required) ? schema.required : []);
  const args = {};
  for (const [name, property] of Object.entries(schema?.properties ?? {})) {
    if (given[name] === undefined && !required.has(name)) continue;
    args[name] = valueFor(property, given[name]);
  }
  return args;
}

/**
 * The model's next step with a custom HTTP tool: `{ call: { name, args } }`, `{ text }` (the reply, after the usual
 * intro) or null when this conversation is not one.
 * @param {{ textOf: (content: unknown) => string, toolNameFor: (messages: unknown[], callId: string) => string }} helpers
 */
export function httpToolStep(body, messages, { textOf, toolNameFor }) {
  const offered = (Array.isArray(body?.tools) ? body.tools : []).map((tool) => tool?.function).filter((fn) => fn?.name && !SYSTEM_TOOLS.has(fn.name));
  if (offered.length === 0) return null;
  const last = messages.at(-1);
  if (last?.role === "tool") {
    const name = toolNameFor(messages, last.tool_call_id);
    return offered.some((fn) => fn.name === name) ? { text: `Resultado de ${name}: ${textOf(last.content)}` } : null;
  }
  if (last?.role !== "user") return null;
  const text = textOf(last.content);
  const words = new Set(text.split(/[^a-z0-9_]+/));
  const tool = offered.find((fn) => words.has(fn.name));
  return tool ? { call: { name: tool.name, args: argumentsFor(tool.parameters, text) } } : null;
}
