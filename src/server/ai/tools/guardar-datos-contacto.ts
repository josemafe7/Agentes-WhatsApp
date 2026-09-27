// guardar_datos_contacto(nombre?, telefono?, email?, notas?) ([HER-01], [HER-04], [HER-07]): saves what the customer
// gave in the conversation's own contact, never another one. Name, phone and email replace the old values (the
// customer is correcting them); notes are added below the team's. The phone is data, never a key ([CAN-13]). In
// «Probar agente» nothing is saved.
import "server-only";
import { z } from "zod";
import { contactInputSchema } from "@/data/contacts";
import { writeContactData } from "@/server/booking/agent-tools";
import { defineTool } from "./registry";

const FIELD_NAMES: Record<string, string> = { name: "nombre", phone: "telefono", email: "email", notes: "notas" };

const parameters = z
  .object({
    nombre: z.string().trim().max(100).optional().describe("Nombre del cliente."),
    telefono: z.string().trim().max(32).optional().describe("Teléfono del cliente."),
    email: z.string().trim().max(254).optional().describe("Email del cliente."),
    notas: z.string().trim().max(500).optional().describe("Algo útil para el equipo que el cliente haya contado (nunca datos de salud, tarjetas ni contraseñas)."),
  })
  .refine((data) => Boolean(data.nombre || data.telefono || data.email || data.notas), "Indica al menos un dato.");

export const guardarDatosContacto = defineTool({
  name: "guardar_datos_contacto",
  description: "Guarda en la ficha del cliente de esta conversación el nombre, el teléfono, el email o una nota que haya dado.",
  parameters,
  async execute(args, context) {
    const parsed = contactInputSchema.safeParse({
      name: args.nombre || undefined,
      phone: args.telefono || undefined,
      email: args.email || undefined,
      notes: args.notas || undefined,
    });
    if (!parsed.success) return { result: { ok: false, error: "El teléfono o el email no son válidos. Pídeselos de nuevo al cliente." } };
    const given = Object.keys(parsed.data).filter((key) => parsed.data[key as keyof typeof parsed.data]);
    if (context.mode === "test") return { result: { ok: true, simulado: true, guardado: given.map((key) => FIELD_NAMES[key] ?? key) } };
    if (!context.contactId) return { result: { ok: false, error: "No hay cliente en esta conversación." } };
    const changed = await writeContactData(context.contactId, parsed.data, { now: context.now });
    return { result: { ok: true, guardado: changed.map((key) => FIELD_NAMES[key] ?? key) } };
  },
});
