import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { agents, agentVersions, appKv, auditLog, channels, rateLimits } from "@/db/schema";
import type { Role } from "@/lib/enums";
import type { Actor } from "@/lib/permissions";
import { getSectorPreset } from "@/lib/sectors";
import { AiNotConfiguredError } from "@/server/ai/errors";
import { WebFetchError } from "@/server/web-fetch";
import { createBusiness, createChannel, createUser, type TestUser } from "@/test/factories";

const state = vi.hoisted(() => ({
  actor: null as Actor | null,
  draftCalls: [] as unknown[],
  draftError: null as Error | null,
}));

vi.mock("@/server/session", async () => {
  const { AuthError } = await import("@/server/errors");
  const { can } = await import("@/lib/permissions");
  const requireActor = async () => {
    if (!state.actor) throw new AuthError("unauthenticated");
    return state.actor;
  };
  return {
    requireActor,
    requirePermission: async (action: Parameters<typeof can>[1]) => {
      const actor = await requireActor();
      if (!can(actor, action)) throw new AuthError("forbidden");
      return actor;
    },
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
// The draft generator reads the web and calls OpenRouter: never in these tests (docs/testing.md).
vi.mock("@/server/ai/draft", () => ({
  generateAgentDraft: async (input: unknown) => {
    state.draftCalls.push(input);
    if (state.draftError) throw state.draftError;
    return {
      name: "Nuria",
      tone: "Cercano",
      instructions: {
        role: "Eres la recepcionista de Peluquería Prueba.",
        businessInfo: "Peluquería de barrio en Valencia.",
        can: "Informar de servicios y horarios.",
        cannot: "Dar precios que no estén en la lista.",
        style: "Cercano y breve.",
        handoff: "Quejas y cambios de última hora.",
      },
    };
  },
}));

import { createAgentAction, deleteAgentAction, duplicateAgentAction, generateAgentDraftAction } from "./actions";

const FORBIDDEN = { ok: false, error: "No tienes permiso para hacer esto." };

let owner: TestUser;
let admin: TestUser;

beforeAll(async () => {
  await createBusiness({ sector: "peluqueria" });
  owner = await createUser("owner", { name: "Lola Propietaria" });
  admin = await createUser("admin", { name: "Ana Admin" });
});

beforeEach(async () => {
  state.actor = owner.actor;
  state.draftCalls.length = 0;
  state.draftError = null;
  await db.delete(channels);
  await db.delete(agentVersions);
  await db.delete(agents);
  await db.delete(auditLog);
  await db.delete(appKv);
  await db.delete(rateLimits);
});

async function agentRows() {
  return db.select().from(agents);
}

describe("Nuevo agente [AGE-02] [AGE-15]", () => {
  it("from the template of the business sector, with its name, instructions and hand-off rules", async () => {
    const template = getSectorPreset("peluqueria").agentTemplate;
    const result = await createAgentAction({ source: "template", sector: "peluqueria", name: template.name });
    expect(result).toMatchObject({ ok: true, data: { id: expect.any(String) } });
    const [agent] = await agentRows();
    expect(agent).toMatchObject({
      id: result.ok ? result.data?.id : "",
      name: template.name,
      instructions: template.instructions,
      templateSector: "peluqueria",
      handoff: { keywords: template.handoff.keywords, messageInHours: template.handoff.messageInHours },
      currentVersion: 1,
    });
  });

  it("from the template of another sector, with the name the person typed", async () => {
    const template = getSectorPreset("restaurante").agentTemplate;
    const result = await createAgentAction({ source: "template", sector: "restaurante", name: "Reservas del local" });
    expect(result.ok).toBe(true);
    const [agent] = await agentRows();
    expect(agent).toMatchObject({ name: "Reservas del local", instructions: template.instructions, templateSector: "restaurante" });
  });

  it("without a name the template keeps its own", async () => {
    await createAgentAction({ source: "template", sector: "taller" });
    const [agent] = await agentRows();
    expect(agent.name).toBe(getSectorPreset("taller").agentTemplate.name);
  });

  it("blank: only the name, no instructions", async () => {
    const result = await createAgentAction({ source: "blank", name: "Asistente" });
    expect(result.ok).toBe(true);
    const [agent] = await agentRows();
    expect(agent).toMatchObject({ name: "Asistente", instructions: {}, templateSector: null, systemTools: ["transferir_a_humano"] });
  });

  it("an agent without a name is not saved and the error is next to the field", async () => {
    const result = await createAgentAction({ source: "blank", name: "   " });
    expect(result).toEqual({ ok: false, error: "Revisa los campos marcados.", fieldErrors: { name: ["Escribe el nombre del agente."] } });
    expect(await agentRows()).toEqual([]);
  });

  it("an unknown template or source is refused", async () => {
    expect(await createAgentAction({ source: "template", sector: "astronautas", name: "X" })).toMatchObject({ ok: false });
    expect(await createAgentAction({ source: "clonar", name: "X" })).toMatchObject({ ok: false });
    expect(await createAgentAction(null)).toMatchObject({ ok: false });
    expect(await agentRows()).toEqual([]);
  });

  it("from a reviewed draft: its instructions over the sector template [AGE-05]", async () => {
    const template = getSectorPreset("peluqueria").agentTemplate;
    const instructions = { role: "Eres Nuria, de recepción.", style: "Muy breve.", cannot: "No hables de la competencia." };
    const result = await createAgentAction({ source: "draft", sector: "peluqueria", name: "Nuria", tone: "Cercano", instructions });
    expect(result.ok).toBe(true);
    const [agent] = await agentRows();
    expect(agent).toMatchObject({ name: "Nuria", tone: "Cercano", instructions, handoff: { keywords: template.handoff.keywords } });
  });

  it("a draft with wrong instructions is not saved", async () => {
    const result = await createAgentAction({ source: "draft", sector: "peluqueria", name: "Nuria", instructions: { role: "x".repeat(4_001) } });
    expect(result).toMatchObject({ ok: false, fieldErrors: { "instructions.role": expect.any(Array) } });
    expect(await agentRows()).toEqual([]);
  });
});

describe("Generar borrador con IA [AGE-05] [ASI-08] [SEG-07]", () => {
  it("from the business web: completes the address and returns the draft without saving anything", async () => {
    const result = await generateAgentDraftAction({ source: "url", url: "www.peluqueria-prueba.es" });
    expect(result).toMatchObject({ ok: true, data: { name: "Nuria", tone: "Cercano", instructions: { role: "Eres la recepcionista de Peluquería Prueba." } } });
    expect(state.draftCalls).toEqual([
      { source: { url: "https://www.peluqueria-prueba.es" }, sector: "peluqueria", business: expect.objectContaining({ name: "Peluquería Prueba" }), agentId: null },
    ]);
    expect(await agentRows()).toEqual([]);
  });

  it("from the editor: the cost is linked to the agent being edited", async () => {
    const created = await createAgentAction({ source: "blank", name: "Recepción" });
    const id = created.ok ? (created.data?.id ?? "") : "";
    await generateAgentDraftAction({ source: "description", description: "Peluquería unisex en Valencia con dos estilistas.", agentId: id });
    expect(state.draftCalls[0]).toMatchObject({ agentId: id });
    // An agent that does not exist is not linked (and nothing is generated).
    expect(await generateAgentDraftAction({ source: "description", description: "Peluquería unisex en Valencia.", agentId: crypto.randomUUID() })).toEqual({
      ok: false,
      error: "No se ha encontrado el agente.",
    });
    expect(state.draftCalls).toHaveLength(1);
  });

  it("when the web cannot be read it says so and nothing changes [ASI-08]", async () => {
    state.draftError = new WebFetchError("host_not_found");
    const result = await generateAgentDraftAction({ source: "url", url: "https://peluqueria-prueba.es" });
    expect(result).toEqual({ ok: false, error: new WebFetchError("host_not_found").userMessage });
    expect(await agentRows()).toEqual([]);
  });

  it("from a description", async () => {
    const description = "Peluquería unisex en Valencia con dos estilistas y una esteticista.";
    const result = await generateAgentDraftAction({ source: "description", description });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(state.draftCalls[0])).toContain(description);
  });

  it("a wrong address or a too short description is explained and nothing is generated", async () => {
    expect(await generateAgentDraftAction({ source: "url", url: "ftp://peluqueria.es" })).toMatchObject({ ok: false, fieldErrors: { url: expect.any(Array) } });
    expect(await generateAgentDraftAction({ source: "url", url: "" })).toMatchObject({ ok: false, fieldErrors: { url: expect.any(Array) } });
    expect(await generateAgentDraftAction({ source: "description", description: "Pelu" })).toMatchObject({
      ok: false,
      fieldErrors: { description: ["Describe el negocio con al menos 20 caracteres."] },
    });
    expect(state.draftCalls).toEqual([]);
  });

  it("without an OpenRouter key it says so [ARR-14]", async () => {
    state.draftError = new AiNotConfiguredError();
    const result = await generateAgentDraftAction({ source: "description", description: "Peluquería unisex en Valencia con dos estilistas." });
    expect(result).toEqual({ ok: false, error: "Añade tu clave de OpenRouter en Ajustes › IA para usar la IA." });
  });

  it("is limited per person: 5 per minute", async () => {
    const input = { source: "description", description: "Peluquería unisex en Valencia con dos estilistas." };
    for (let i = 0; i < 5; i += 1) expect((await generateAgentDraftAction(input)).ok).toBe(true);
    expect(await generateAgentDraftAction(input)).toMatchObject({ ok: false, error: expect.stringContaining("Espera un minuto") });
    expect(state.draftCalls).toHaveLength(5);
    // Another person has their own limit.
    state.actor = admin.actor;
    expect((await generateAgentDraftAction(input)).ok).toBe(true);
  });
});

describe("Duplicar y borrar [AGE-13]", () => {
  it("duplicates an agent as «Copia de …»", async () => {
    const created = await createAgentAction({ source: "blank", name: "Recepción" });
    const id = created.ok ? (created.data?.id ?? "") : "";
    const copy = await duplicateAgentAction({ agentId: id });
    expect(copy).toMatchObject({ ok: true, data: { id: expect.any(String) } });
    expect((await agentRows()).map((agent) => agent.name).sort()).toEqual(["Copia de Recepción", "Recepción"]);
  });

  it("deleting an agent active in a channel asks for confirmation and then leaves the channel without agent", async () => {
    const created = await createAgentAction({ source: "blank", name: "Recepción" });
    const id = created.ok ? (created.data?.id ?? "") : "";
    const channel = await createChannel({ name: "Chat de la web", activeAgentId: id });

    const refused = await deleteAgentAction({ agentId: id });
    expect(refused).toMatchObject({ ok: false, error: expect.stringContaining("Chat de la web") });
    expect(await agentRows()).toHaveLength(1);

    expect(await deleteAgentAction({ agentId: id, confirmActiveChannels: true })).toMatchObject({ ok: true });
    expect(await agentRows()).toEqual([]);
    const [row] = await db.select().from(channels).where(eq(channels.id, channel.id));
    expect(row.activeAgentId).toBeNull();
  });

  it("an agent that does not exist gives a clear error", async () => {
    expect(await deleteAgentAction({ agentId: crypto.randomUUID() })).toEqual({ ok: false, error: "No se ha encontrado el agente." });
    expect(await duplicateAgentAction({ agentId: "no-es-un-id" })).toMatchObject({ ok: false });
  });
});

describe.each<Role>(["supervisor", "agent", "viewer"])("Agentes as %s [PER-01] [SEG-04]", (role) => {
  it("cannot create, generate, duplicate or delete, and nothing changes", async () => {
    const created = await createAgentAction({ source: "blank", name: "Recepción" });
    const id = created.ok ? (created.data?.id ?? "") : "";
    await db.delete(auditLog);
    state.actor = (await createUser(role)).actor;

    expect(await createAgentAction({ source: "blank", name: "Intruso" })).toEqual(FORBIDDEN);
    expect(await createAgentAction({ source: "template", sector: "peluqueria", name: "Intruso" })).toEqual(FORBIDDEN);
    expect(await generateAgentDraftAction({ source: "url", url: "https://peluqueria.es" })).toEqual(FORBIDDEN);
    expect(await duplicateAgentAction({ agentId: id })).toEqual(FORBIDDEN);
    expect(await deleteAgentAction({ agentId: id, confirmActiveChannels: true })).toEqual(FORBIDDEN);

    expect((await agentRows()).map((agent) => agent.name)).toEqual(["Recepción"]);
    expect(state.draftCalls).toEqual([]);
    expect(await db.select().from(auditLog)).toEqual([]);
  });
});

describe("Agentes without a session [SEG-04]", () => {
  it("every action asks to sign in again", async () => {
    state.actor = null;
    const expired = { ok: false, error: "Tu sesión ha caducado. Vuelve a entrar." };
    expect(await createAgentAction({ source: "blank", name: "Recepción" })).toEqual(expired);
    expect(await generateAgentDraftAction({ source: "url", url: "https://peluqueria.es" })).toEqual(expired);
    expect(await duplicateAgentAction({ agentId: crypto.randomUUID() })).toEqual(expired);
    expect(await deleteAgentAction({ agentId: crypto.randomUUID() })).toEqual(expired);
    expect(await agentRows()).toEqual([]);
  });
});
