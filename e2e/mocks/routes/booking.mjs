// Booking conversations of the simulated model (fase 5 · Agenda: [HER-01], [HER-05], [HER-06], [AGD-13], [AGD-21]–[AGD-23]).
// Used by ./openrouter.mjs only when the agent has listar_servicios, consultar_disponibilidad and crear_cita, and only in
// the conversations the agenda specs start: a customer message with a date written «AAAA-MM-DD» (no other spec writes
// one), or the answer to an offer made here. Deterministic, like the rest of the simulated model:
//   1. Ask: «… <servicio> [con <profesional>] el AAAA-MM-DD [a partir de las HH:MM] [para N personas], a nombre de
//      <nombre>[, email <email>]» → listar_servicios; from its list, the service (and who does it) whose name is in the
//      message, the longest one if several → consultar_disponibilidad(servicio, desde = the date [+ «a partir de» time],
//      hasta = the date, profesional?, personas?). With the slots the reply offers the 2–3 suggested ones, each with its
//      «inicio» in brackets so a later turn reads it back:
//      «Para «Corte de hombre» con Andrés tengo estos huecos: 1) miércoles 21 de octubre a las 10:00 [2026-10-21T10:00];
//      2) …. ¿Cuál te viene bien?». Without slots, the tool's own message.
//   2. Confirm an offer: «Me va bien la primera» (confirmo, me va bien, me viene bien, perfecto, de acuerdo or vale; «la
//      segunda», «la tercera» or the slot's time pick another) right after an offer → crear_cita with that slot, the
//      offer's service, professional and group, and the name and email the customer gave (a message «a nombre de …»;
//      else the name of the prompt's «Cliente:» line) → the reply is the tool's «confirmar_al_cliente» ([AGD-23]). A slot
//      that is gone gets the tool's error and its alternatives, offered the same way ([AGD-13], [HER-06]).
//   3. Book straight away: «Confirmo <servicio> [con <profesional>|en <sala>] el AAAA-MM-DD a las HH:MM [para N
//      personas], a nombre de <nombre>» → listar_servicios, then crear_cita with that start (no offer first).
// Every reply begins like the other answers of the model («Soy <agente>, el asistente de IA de este negocio. … Me has
// escrito: «…».»), so the specs' helpers for replies keep working.

const LIST = "listar_servicios";
const CHECK = "consultar_disponibilidad";
const CREATE = "crear_cita";
const BOOKING_TOOLS = [LIST, CHECK, CREATE];

const ISO_DATE = /\b(\d{4}-\d{2}-\d{2})\b/;
const AT_TIME = /\ba las (\d{1,2}):(\d{2})\b/i;
const FROM_TIME = /\ba partir de las (\d{1,2}):(\d{2})\b/i;
const ANY_TIME = /\b(\d{1,2}):(\d{2})\b/;
const PEOPLE = /\b(\d{1,3})\s*(?:personas|comensales)\b/i;
const NAME = /a nombre de ([^,.;\n]+)/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
const CONFIRM = /\b(confirmo|me va bien|me viene bien|perfecto|de acuerdo|vale)\b/i;
/** «[2026-10-21T10:00]», with the offset of a repeated time when there is one ([AGD-10]). */
const SLOT_MARK = /\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?:[+-]\d{2}:\d{2})?)\]/g;
const OFFER_VERB = "tengo estos huecos";
const ALTERNATIVES_VERB = "te propongo estos otros huecos";
const OFFER_HEAD = new RegExp(`Para «([^»]+)»(?: con ([^(:]+?))?(?: \\((\\d+) personas\\))? (?:${OFFER_VERB}|${ALTERNATIVES_VERB}):`);
/** «la segunda» / «la tercera» (the first is the default). */
const ORDINALS = [
  [1, /\b(segund[oa]|2)\b/i],
  [2, /\b(tercer[oa]?|3)\b/i],
];
const DEFAULT_NAME = "Cliente";

/** Lower case, without accents or extra spaces: «Andrés» is found in «con andres». */
function normalize(text) {
  return String(text)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function offersTool(body, name) {
  return Array.isArray(body?.tools) && body.tools.some((tool) => tool?.function?.name === name);
}

/** The JSON a tool answered, or null (the app cuts long answers with «…»). */
function parseResult(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

/** The services of a listar_servicios answer: { nombre, con: [{ nombre }] }. Read by pattern when it came cut short. */
function servicesFrom(text) {
  const parsed = parseResult(text);
  if (Array.isArray(parsed?.servicios)) return parsed.servicios;
  const services = [];
  for (const match of text.matchAll(/\{"id":"[^"]+","nombre":"([^"]+)"[^[]*?"con":\[([^\]]*)\]/g)) {
    services.push({ nombre: match[1], con: [...match[2].matchAll(/"nombre":"([^"]+)"/g)].map((found) => ({ nombre: found[1] })) });
  }
  return services;
}

/** The item whose name is in `text` (the longest if several), or null. */
function byNameIn(items, text) {
  const wanted = normalize(text);
  const found = (items ?? [])
    .filter((item) => typeof item?.nombre === "string" && item.nombre && wanted.includes(normalize(item.nombre)))
    .sort((a, b) => b.nombre.length - a.nombre.length);
  return found[0] ?? null;
}

/** The arguments of the tool call a tool message answers. */
function callArguments(messages, callId) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const calls = messages[index]?.role === "assistant" && Array.isArray(messages[index].tool_calls) ? messages[index].tool_calls : [];
    const call = calls.find((candidate) => candidate?.id === callId);
    if (call) return parseResult(String(call.function?.arguments ?? "")) ?? {};
  }
  return {};
}

/** Name and email the customer gave (the latest message that has them), or the prompt's «Cliente:» name. */
function customerDetails(messages, textOf) {
  const texts = messages
    .filter((message) => message?.role === "user")
    .map((message) => textOf(message.content))
    .reverse();
  const name = texts.map((text) => NAME.exec(text)?.[1]?.trim()).find(Boolean);
  const email = texts.map((text) => EMAIL.exec(text)?.[0]).find(Boolean);
  const system = textOf(messages.find((message) => message?.role === "system")?.content);
  const promptName = /^Cliente: ([^(\n]+)/m.exec(system)?.[1]?.trim();
  const known = promptName && promptName !== "sin datos guardados." && promptName !== "sin nombre conocido" ? promptName : null;
  return { nombre: name || known || DEFAULT_NAME, ...(email ? { email } : {}) };
}

/** «Para «X» con Y (N personas) tengo estos huecos: 1) … [inicio]; 2) … [inicio].» */
function offerLine(servicio, profesional, personas, slots, verb) {
  const who = profesional ? ` con ${profesional}` : "";
  const group = personas && personas > 1 ? ` (${personas} personas)` : "";
  const list = slots.map((slot, index) => `${index + 1}) ${slot.dia} a las ${slot.hora} [${slot.inicio}]`).join("; ");
  return `Para «${servicio}»${who}${group} ${verb}: ${list}.`;
}

/** The offer of the model's previous reply (the last assistant text), or null. */
function lastOffer(messages, textOf) {
  const previous = messages.slice(0, -1).findLast((message) => message?.role === "assistant" && textOf(message.content));
  const text = textOf(previous?.content);
  const head = OFFER_HEAD.exec(text);
  if (!head) return null;
  const slots = [...text.matchAll(SLOT_MARK)].map((match) => ({ inicio: match[1], hora: match[1].slice(11, 16) }));
  if (slots.length === 0) return null;
  return { servicio: head[1], profesional: head[2]?.trim() || null, personas: head[3] ? Number(head[3]) : null, slots };
}

/** The slot the customer chose: by its time, «la segunda» / «la tercera», or the first. */
function chosenSlot(slots, text) {
  const time = ANY_TIME.exec(text);
  if (time) {
    const wanted = `${pad(time[1])}:${time[2]}`;
    const byTime = slots.find((slot) => slot.hora === wanted);
    if (byTime) return byTime;
  }
  for (const [index, pattern] of ORDINALS) if (pattern.test(text) && slots[index]) return slots[index];
  return slots[0];
}

function withOptional(args, extra) {
  const result = { ...args };
  for (const [key, value] of Object.entries(extra)) if (value !== null && value !== undefined && value !== "") result[key] = value;
  return result;
}

/** After listar_servicios: book straight away (step 3) or look for slots (step 1). */
function afterServices(messages, toolMessage, textOf) {
  const text = textOf(messages.findLast((message) => message?.role === "user")?.content);
  const services = servicesFrom(textOf(toolMessage.content));
  if (services.length === 0) return { text: "No hay servicios que se puedan reservar ahora mismo." };
  const service = byNameIn(services, text) ?? services[0];
  const resource = byNameIn(service.con, text);
  const people = PEOPLE.exec(text);
  const date = ISO_DATE.exec(text)?.[1];
  const at = AT_TIME.exec(text);
  const common = { profesional: resource?.nombre, personas: people ? Number(people[1]) : null };
  if (CONFIRM.test(text) && at) {
    return {
      call: { name: CREATE, args: withOptional({ servicio: service.nombre, inicio: `${date}T${pad(at[1])}:${at[2]}` }, { ...common, ...customerDetails(messages, textOf) }) },
    };
  }
  const from = FROM_TIME.exec(text);
  return { call: { name: CHECK, args: withOptional({ servicio: service.nombre, desde: from ? `${date}T${pad(from[1])}:${from[2]}` : date, hasta: date }, common) } };
}

/** After consultar_disponibilidad: offer the suggested slots, or say there are none. */
function afterAvailability(messages, toolMessage, textOf) {
  const result = parseResult(textOf(toolMessage.content));
  const args = callArguments(messages, toolMessage.tool_call_id);
  if (!result?.ok) return { text: result?.error ?? "No he podido consultar la agenda." };
  const slots = Array.isArray(result.sugeridos) ? result.sugeridos : [];
  if (slots.length === 0) return { text: result.mensaje ?? "No hay huecos libres en esas fechas." };
  return { text: `${offerLine(result.servicio ?? args.servicio, args.profesional, result.personas ?? args.personas, slots, OFFER_VERB)} ¿Cuál te viene bien?` };
}

/** After crear_cita: its confirmation for the customer, or its error and the alternatives. */
function afterCreate(messages, toolMessage, textOf) {
  const result = parseResult(textOf(toolMessage.content));
  const args = callArguments(messages, toolMessage.tool_call_id);
  if (result?.ok) return { text: String(result.confirmar_al_cliente ?? "Reserva hecha.") };
  const error = String(result?.error ?? "No he podido reservar.");
  const alternatives = Array.isArray(result?.alternativas) ? result.alternativas : [];
  if (alternatives.length === 0) return { text: error };
  return { text: `${error} ${offerLine(args.servicio, args.profesional, args.personas, alternatives, ALTERNATIVES_VERB)} ¿Te viene bien alguno?` };
}

/**
 * The model's next step in a booking conversation: `{ call: { name, args } }` (a tool call), `{ text }` (the reply, to
 * be put after the usual intro) or null when this is not one.
 * @param {{ textOf: (content: unknown) => string, toolNameFor: (messages: unknown[], callId: string) => string }} helpers
 */
export function bookingStep(body, messages, { textOf, toolNameFor }) {
  if (!BOOKING_TOOLS.every((name) => offersTool(body, name))) return null;
  const last = messages.at(-1);
  if (last?.role === "tool") {
    const tool = toolNameFor(messages, last.tool_call_id);
    if (tool === LIST) return afterServices(messages, last, textOf);
    if (tool === CHECK) return afterAvailability(messages, last, textOf);
    if (tool === CREATE) return afterCreate(messages, last, textOf);
    return null;
  }
  if (last?.role !== "user") return null;
  const text = textOf(last.content);
  const hasDate = ISO_DATE.test(text);
  if (CONFIRM.test(text) && !hasDate) {
    const offer = lastOffer(messages, textOf);
    if (!offer) return null;
    const slot = chosenSlot(offer.slots, text);
    const args = withOptional({ servicio: offer.servicio, inicio: slot.inicio }, { profesional: offer.profesional, personas: offer.personas, ...customerDetails(messages, textOf) });
    return { call: { name: CREATE, args } };
  }
  return hasDate ? { call: { name: LIST, args: {} } } : null;
}
