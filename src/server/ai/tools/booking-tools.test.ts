import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureSettingsRows } from "@/data/settings";
import { db } from "@/db";
import { agents, aiRuns, appKv, auditLog, bookings, contacts, integrationSettings, notifications, services } from "@/db/schema";
import { createBooking, type BookingActor } from "@/server/booking";
import { addResource, at, createHairdresser, NOW, TZ } from "@/server/booking/test-helpers";
import { formatLocalMinute } from "@/server/booking/time";
import { chatCompletion, FAKE_OPENROUTER_KEY, fakeFetch, jsonResponse, routes, sampleCatalog, sequence } from "@/test/fake-openrouter";
import { createAgentRow, createChannel, createContactWithIdentity, createConversation, createUser } from "@/test/factories";
import { runAgent } from "../run-agent";
import { executeToolCall, toolDefinitions, toolsForAgent, type ToolContext } from "./index";

const BOOKING_TOOLS = ["listar_servicios", "consultar_disponibilidad", "crear_cita", "ver_citas_del_cliente", "cancelar_cita", "reprogramar_cita", "guardar_datos_contacto"];
const tools = toolsForAgent(BOOKING_TOOLS);

let agentId: string;
let person: BookingActor;
let hair: Awaited<ReturnType<typeof createHairdresser>>;

type Customer = { contactId: string; conversationId: string; channelId: string };

async function customer(name = "Lucía", overrides: { phone?: string | null; email?: string | null } = {}): Promise<Customer> {
  const channel = await createChannel({ type: "webchat" });
  const { contact } = await createContactWithIdentity("webchat", { name, phone: overrides.phone ?? null, email: overrides.email ?? null });
  const conversation = await createConversation(channel.id, contact.id);
  return { contactId: contact.id, conversationId: conversation.id, channelId: channel.id };
}

function live(who: Customer, overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    mode: "live",
    agentId,
    conversationId: who.conversationId,
    contactId: who.contactId,
    channelId: who.channelId,
    now: NOW,
    timezone: TZ,
    withinBusinessHours: true,
    handoff: {},
    ...overrides,
  };
}

const testMode = (): ToolContext => ({ ...live({ contactId: "", conversationId: "", channelId: "" }), mode: "test", contactId: null, conversationId: null, channelId: null });

let callNumber = 0;
async function call(name: string, args: unknown, context: ToolContext) {
  const outcome = await executeToolCall(tools, { id: `call_${++callNumber}`, type: "function", function: { name, arguments: JSON.stringify(args) } }, context);
  return outcome.record.result as Record<string, unknown> & { ok: boolean };
}

async function bookFor(who: Customer | null, start: string, serviceId = hair.cut.id) {
  return createBooking({ serviceId, resourceId: "any", start: at(start), contactId: who?.contactId ?? null, contactName: who ? undefined : "Otra", source: "human", actor: person, now: NOW });
}

beforeAll(async () => {
  const owner = await createUser("owner", { name: "Dueña" });
  person = { type: "user", userId: owner.userId, name: owner.name };
});

beforeEach(async () => {
  hair = await createHairdresser();
  agentId = (await createAgentRow({ name: "Recepción Lola", systemTools: BOOKING_TOOLS })).id;
  await db.delete(auditLog);
  await db.delete(notifications);
});

describe("the booking tools are system tools of the agent [HER-01] [HER-02]", () => {
  it("each one is offered to the model with its Spanish parameters", () => {
    const definitions = toolDefinitions(tools);
    expect(definitions.map((definition) => definition.function.name)).toEqual(["transferir_a_humano", ...BOOKING_TOOLS]);
    const create = definitions.find((definition) => definition.function.name === "crear_cita")?.function.parameters;
    expect(create).toMatchObject({ required: ["servicio", "inicio", "nombre"], properties: { profesional: { type: "string" }, personas: { type: "integer" } } });
    const availability = definitions.find((definition) => definition.function.name === "consultar_disponibilidad")?.function.parameters;
    expect(availability).toMatchObject({ required: ["servicio", "desde", "hasta"] });
  });

  it("wrong data returns an error to the model and changes nothing", async () => {
    const who = await customer();
    expect((await call("crear_cita", { servicio: "Corte", inicio: "mañana", nombre: "Lucía" }, live(who))).ok).toBe(false);
    expect((await call("cancelar_cita", { cita_id: "no-es-un-id" }, live(who))).error).toMatch(/Datos no válidos/);
    expect((await call("guardar_datos_contacto", {}, live(who))).error).toMatch(/Datos no válidos/);
    expect(await db.select().from(bookings)).toHaveLength(0);
  });
});

describe("listar_servicios [HER-01] [AGD-04]", () => {
  it("lists what can be booked, with ids, duration, price only when set, and who does it", async () => {
    await db.insert(services).values({ name: "Retirado", durationMin: 30, active: false });
    const nobody = await addResource({ name: "De baja", active: false });
    await db.insert(services).values({ name: "Sin nadie", durationMin: 30 }).returning();
    expect(nobody.active).toBe(false);
    const result = await call("listar_servicios", {}, live(await customer()));
    expect(result).toMatchObject({ ok: true, recurso: "profesional" });
    expect(result.servicios).toEqual([
      { id: hair.cut.id, nombre: "Corte", duracion_min: 30, precio_orientativo: 18, descripcion: "Corte con lavado.", con: [{ id: hair.laura.id, nombre: "Laura" }, { id: hair.marta.id, nombre: "Marta" }] },
      { id: hair.dye.id, nombre: "Tinte", duracion_min: 60, requiere_confirmacion_del_equipo: true, con: [{ id: hair.laura.id, nombre: "Laura" }] },
    ]);
  });
});

describe("consultar_disponibilidad: real slots, 2 or 3 suggested [HER-05] [AGD-21]", () => {
  it("finds the service by name without accents or case, and suggests slots spread over the day", async () => {
    const result = await call("consultar_disponibilidad", { servicio: "CORTE", desde: "2026-09-28", hasta: "2026-09-28" }, live(await customer()));
    expect(result).toMatchObject({ ok: true, servicio: "Corte", huecos: 18 });
    expect(result.sugeridos).toEqual([
      { inicio: "2026-09-28T09:00", dia: "lunes 28 de septiembre", hora: "09:00", con: ["Laura", "Marta"] },
      { inicio: "2026-09-28T11:00", dia: "lunes 28 de septiembre", hora: "11:00", con: ["Laura", "Marta"] },
      { inicio: "2026-09-28T13:00", dia: "lunes 28 de septiembre", hora: "13:00", con: ["Laura", "Marta"] },
    ]);
    expect(result.otros).toHaveLength(12);
    expect((result.otros as string[])[0]).toBe("2026-09-28T09:30");
  });

  it("respects the professional asked for, the bookings already made and «ahora»", async () => {
    await bookFor(null, "2026-09-28T16:00");
    const who = await customer();
    const laura = await call("consultar_disponibilidad", { servicio: hair.cut.id, desde: "2026-09-28T15:00", hasta: "2026-09-28T17:00", profesional: "laura" }, live(who));
    expect((laura.sugeridos as { inicio: string }[]).map((slot) => slot.inicio)).toEqual(["2026-09-28T16:30"]);
    const late = await call("consultar_disponibilidad", { servicio: "Corte", desde: "2026-09-28", hasta: "2026-09-28" }, live(who, { now: at("2026-09-28T19:00") }));
    expect((late.sugeridos as { inicio: string }[]).map((slot) => slot.inicio)).toEqual(["2026-09-28T19:00", "2026-09-28T19:30"]);
  });

  it("says why there is nothing, and never invents a service or a professional", async () => {
    const who = await customer();
    expect(await call("consultar_disponibilidad", { servicio: "Corte", desde: "2026-10-04", hasta: "2026-10-04" }, live(who))).toMatchObject({ ok: true, huecos: 0 });
    expect(await call("consultar_disponibilidad", { servicio: "Corte", desde: "2026-09-28", hasta: "2026-09-28", personas: 3 }, live(who))).toMatchObject({
      huecos: 0,
      mensaje: "El número de personas no está entre el mínimo y el máximo del servicio.",
    });
    const unknown = await call("consultar_disponibilidad", { servicio: "Masaje", desde: "2026-09-28", hasta: "2026-09-28" }, live(who));
    expect(unknown).toMatchObject({ ok: false });
    expect(unknown.error).toContain("Corte, Tinte");
    expect((await call("consultar_disponibilidad", { servicio: "Tinte", desde: "2026-09-28", hasta: "2026-09-28", profesional: "Marta" }, live(who))).error).toContain("Laura");
    expect((await call("consultar_disponibilidad", { servicio: "Corte", desde: "2026-09-30", hasta: "2026-09-28" }, live(who))).ok).toBe(false);
  });

  it("looks at two weeks at most per call", async () => {
    const result = await call("consultar_disponibilidad", { servicio: "Corte", desde: "2026-09-28", hasta: "2026-12-31" }, live(await customer()));
    expect(result.nota).toMatch(/14 días/);
    expect(result.hasta).toBe(formatLocalMinute(new Date(at("2026-09-28").getTime() + 14 * 86_400_000), TZ));
  });
});

describe("crear_cita [HER-06] [AGD-13] [AGD-14] [AGD-22] [AGD-23]", () => {
  it("books for the conversation's contact, through its channel, by the agent, and gives the confirmation for the reply", async () => {
    const who = await customer("Lucía");
    const result = await call("crear_cita", { servicio: "Corte", inicio: "2026-09-28T10:00", profesional: "Marta", nombre: "Lucía Pérez", telefono: "+34 600 111 222", email: "lucia@example.com" }, live(who));
    expect(result).toMatchObject({
      ok: true,
      cita: { servicio: "Corte", inicio: "2026-09-28T10:00", dia: "lunes 28 de septiembre", hora: "10:00", con: "Marta", personas: 1, estado: "confirmada" },
      confirmar_al_cliente: "Tu cita de Corte queda confirmada para el lunes 28 de septiembre a las 10:00 con Marta.",
    });
    const [row] = await db.select().from(bookings);
    expect(row).toMatchObject({ contactId: who.contactId, conversationId: who.conversationId, channelId: who.channelId, source: "ai", contactName: "Lucía Pérez", createdByName: "Recepción Lola", isTest: false, resourceId: hair.marta.id });
    // Blanks of the contact are filled; the name the team knows stays.
    const [contact] = await db.select().from(contacts).where(eq(contacts.id, who.contactId));
    expect(contact).toMatchObject({ name: "Lucía", phone: "+34 600 111 222", email: "lucia@example.com" });
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, "ai.tool_called"));
    expect(entry.metadata).toMatchObject({ tool: "crear_cita", ok: true, mode: "live" });
  });

  it("a service with manual confirmation is left pending, the agent says so and the team is told", async () => {
    const result = await call("crear_cita", { servicio: "Tinte", inicio: "2026-09-28T12:00", nombre: "Nuria" }, live(await customer("Nuria")));
    expect(result).toMatchObject({ ok: true, cita: { estado: "pendiente" } });
    expect(result.confirmar_al_cliente).toBe("Tu cita de Tinte del lunes 28 de septiembre a las 12:00 queda pendiente de confirmar: el equipo la revisará y te avisaremos.");
    expect(await db.select().from(notifications).where(eq(notifications.event, "booking_pending"))).toHaveLength(1);
  });

  it("a slot taken meanwhile is refused with «Ese hueco ya no está libre» and the closest alternatives", async () => {
    await bookFor(null, "2026-09-28T10:00", hair.dye.id);
    const result = await call("crear_cita", { servicio: "Tinte", inicio: "2026-09-28T10:00", nombre: "Ana" }, live(await customer("Ana")));
    expect(result).toMatchObject({ ok: false, error: "Ese hueco ya no está libre." });
    expect((result.alternativas as { inicio: string }[]).map((slot) => slot.inicio)).toEqual(["2026-09-28T09:00", "2026-09-28T11:00", "2026-09-28T11:30"]);
    expect(await db.select().from(bookings)).toHaveLength(1);
  });

  it("refuses a wrong email or phone and books nothing", async () => {
    const result = await call("crear_cita", { servicio: "Corte", inicio: "2026-09-28T10:00", nombre: "Ana", email: "no-es-email" }, live(await customer()));
    expect(result.ok).toBe(false);
    expect(await db.select().from(bookings)).toHaveLength(0);
  });

  it("in «Probar agente» the booking is a test one, without contact [PRU-04]", async () => {
    const result = await call("crear_cita", { servicio: "Corte", inicio: "2026-09-28T10:00", nombre: "Prueba" }, testMode());
    expect(result).toMatchObject({ ok: true, prueba: true });
    const [row] = await db.select().from(bookings);
    expect(row).toMatchObject({ isTest: true, contactId: null, conversationId: null, channelId: null, contactName: "Prueba" });
  });
});

describe("a customer never sees or changes another customer's bookings [HER-04] [PER-08] [HER-09]", () => {
  it("ver_citas_del_cliente lists only the conversation's contact's upcoming bookings", async () => {
    const me = await customer("Yo");
    const other = await customer("Otra");
    await bookFor(me, "2026-09-28T10:00");
    await bookFor(other, "2026-09-28T11:00");
    await bookFor(me, "2026-09-26T10:00").catch(() => null);
    const mine = await call("ver_citas_del_cliente", {}, live(me));
    expect((mine.citas as { inicio: string }[]).map((booking) => booking.inicio)).toEqual(["2026-09-28T10:00"]);
    expect(JSON.stringify(mine)).not.toContain("11:00");
    const test = await call("ver_citas_del_cliente", {}, testMode());
    expect(test).toMatchObject({ ok: true, citas: [], mensaje: "El cliente no tiene citas próximas." });
  });

  it("cancelar_cita and reprogramar_cita answer «not found» for another contact's booking and change nothing", async () => {
    const me = await customer("Yo");
    const other = await customer("Otra");
    const hers = await bookFor(other, "2026-09-28T11:00");
    expect(await call("cancelar_cita", { cita_id: hers.id }, live(me))).toEqual({ ok: false, error: "No se ha encontrado la cita." });
    expect(await call("reprogramar_cita", { cita_id: hers.id, nuevo_inicio: "2026-09-28T12:00" }, live(me))).toEqual({ ok: false, error: "No se ha encontrado la cita." });
    expect(await call("cancelar_cita", { cita_id: hers.id }, testMode())).toEqual({ ok: false, error: "No se ha encontrado la cita." });
    const [row] = await db.select().from(bookings).where(eq(bookings.id, hers.id));
    expect(row.status).toBe("confirmed");
    expect(formatLocalMinute(row.startsAt, TZ)).toBe("2026-09-28T11:00");
  });

  it("cancelar_cita cancels the customer's own booking and gives the confirmation [AGD-26]", async () => {
    const me = await customer("Yo");
    const mine = await bookFor(me, "2026-09-28T10:00");
    const result = await call("cancelar_cita", { cita_id: mine.id, motivo: "No puedo ir" }, live(me));
    expect(result).toMatchObject({ ok: true, cita: { estado: "cancelada" }, confirmar_al_cliente: "Tu cita de Corte del lunes 28 de septiembre a las 10:00 queda cancelada." });
    const [row] = await db.select().from(bookings).where(eq(bookings.id, mine.id));
    expect(row).toMatchObject({ status: "cancelled", cancelReason: "No puedo ir" });
    expect((await call("cancelar_cita", { cita_id: mine.id }, live(me))).ok).toBe(true);
  });

  it("reprogramar_cita moves the customer's own booking, or offers alternatives when the new slot is taken", async () => {
    const me = await customer("Yo");
    const mine = await bookFor(me, "2026-09-28T10:00");
    await createBooking({ serviceId: hair.cut.id, resourceId: mine.resource.id, start: at("2026-09-28T12:00"), contactId: null, contactName: "Otra", source: "human", actor: person, now: NOW });
    const taken = await call("reprogramar_cita", { cita_id: mine.id, nuevo_inicio: "2026-09-28T12:00" }, live(me));
    expect(taken).toMatchObject({ ok: false, error: "Ese hueco ya no está libre." });
    expect((taken.alternativas as unknown[]).length).toBeGreaterThan(0);
    const moved = await call("reprogramar_cita", { cita_id: mine.id, nuevo_inicio: "2026-09-29T17:30" }, live(me));
    expect(moved).toMatchObject({ ok: true, cita: { inicio: "2026-09-29T17:30" }, confirmar_al_cliente: `Tu cita de Corte queda cambiada al martes 29 de septiembre a las 17:30 con ${mine.resource.name}.` });
  });
});

describe("guardar_datos_contacto [HER-07] [HER-04]", () => {
  it("saves name, phone and email in the conversation's contact, adds notes below the team's, and touches nobody else", async () => {
    const me = await customer("Luci", { email: "vieja@example.com" });
    const other = await customer("Otra");
    await db.update(contacts).set({ notes: "Cliente habitual." }).where(eq(contacts.id, me.contactId));
    const result = await call("guardar_datos_contacto", { nombre: "Lucía Pérez", telefono: "600 111 222", email: "lucia@example.com", notas: "Prefiere las tardes." }, live(me));
    expect(result).toEqual({ ok: true, guardado: ["nombre", "telefono", "email", "notas"] });
    const [mine] = await db.select().from(contacts).where(eq(contacts.id, me.contactId));
    expect(mine).toMatchObject({ name: "Lucía Pérez", phone: "600 111 222", email: "lucia@example.com", notes: "Cliente habitual.\nPrefiere las tardes." });
    const [hers] = await db.select().from(contacts).where(eq(contacts.id, other.contactId));
    expect(hers).toMatchObject({ name: "Otra", phone: null, email: null });
  });

  it("refuses a wrong phone and saves nothing in «Probar agente»", async () => {
    const me = await customer("Luci");
    expect((await call("guardar_datos_contacto", { telefono: "llámame" }, live(me))).ok).toBe(false);
    expect(await call("guardar_datos_contacto", { nombre: "Otra persona" }, testMode())).toEqual({ ok: true, simulado: true, guardado: ["nombre"] });
    const [mine] = await db.select().from(contacts).where(eq(contacts.id, me.contactId));
    expect(mine.name).toBe("Luci");
  });
});

describe("with the peluquería, the agent offers real slots and books [AGD-21] [HER-05]", () => {
  beforeEach(async () => {
    await ensureSettingsRows();
    await db.update(integrationSettings).set({ zdr: false });
    await db.delete(appKv);
    await db.delete(aiRuns);
    vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("looks up the slots, books the one the customer chose and answers once", async () => {
    const who = await customer("Lucía");
    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    const fake = fakeFetch(
      routes({
        "GET /models/user": () => jsonResponse({ data: sampleCatalog() }),
        "POST /chat/completions": sequence(
          () => jsonResponse(chatCompletion({ toolCalls: [{ name: "consultar_disponibilidad", arguments: { servicio: "Corte", desde: "2026-09-28", hasta: "2026-09-28" } }] })),
          () => jsonResponse(chatCompletion({ toolCalls: [{ name: "crear_cita", arguments: { servicio: "Corte", inicio: "2026-09-28T11:00", nombre: "Lucía" } }] })),
          () => jsonResponse(chatCompletion({ content: "¡Hecho! Tu cita de Corte queda confirmada para el lunes 28 de septiembre a las 11:00 con Laura." })),
        ),
      }),
    );
    const result = await runAgent(
      {
        agent,
        history: [{ role: "contact", text: "Sí, el lunes a las 11 me va bien." }],
        mode: "live",
        context: { conversationId: who.conversationId, contactId: who.contactId, channelId: who.channelId, channelKind: "webchat" },
      },
      { fetchImpl: fake.fetch, now: NOW },
    );
    expect(result.toolCalls.map((record) => [record.name, record.ok])).toEqual([
      ["consultar_disponibilidad", true],
      ["crear_cita", true],
    ]);
    expect(result.text).toContain("11:00");
    const [row] = await db.select().from(bookings).where(and(eq(bookings.contactId, who.contactId), eq(bookings.source, "ai")));
    expect(formatLocalMinute(row.startsAt, TZ)).toBe("2026-09-28T11:00");
    // The tool results reach the model as data for its one reply.
    const second = fake.calls.filter((c) => c.path === "/chat/completions")[1].body as { messages: { role: string; content: string }[] };
    expect(second.messages.at(-1)).toMatchObject({ role: "tool" });
    expect(second.messages.at(-1)?.content).toContain("2026-09-28T09:00");
  });
});
