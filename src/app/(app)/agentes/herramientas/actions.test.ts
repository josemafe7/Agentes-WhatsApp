import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { agentCustomTools, agents, auditLog, customTools, rateLimits } from "@/db/schema";
import type { Role } from "@/lib/enums";
import type { Actor } from "@/lib/permissions";
import { createBusiness, createUser, type TestUser } from "@/test/factories";

const SECRET = "sk-live-n8n-aabbccddeeff0011";

const state = vi.hoisted(() => ({ actor: null as Actor | null, calls: [] as { url: string; headers: Headers }[] }));

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
// «Probar» reaches a fake service behind a public address: tests never call outside.
vi.mock("@/data/custom-tools", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/data/custom-tools")>();
  return {
    ...original,
    testCustomTool: (actor: Actor, toolId: unknown, args: unknown) =>
      original.testCustomTool(actor, toolId, args, {
        fetchImpl: async (url, init) => {
          const headers = new Headers(init.headers);
          state.calls.push({ url, headers });
          return Response.json({ recibido: true, eco: headers.get("authorization") });
        },
        resolveHost: async () => [{ address: "93.184.215.14", family: 4 }],
        allowLocal: false,
      }),
  };
});

import { deleteCustomToolAction, saveCustomToolAction, testCustomToolAction } from "./actions";

const FORBIDDEN = { ok: false, error: "No tienes permiso para hacer esto." };
const users = {} as Record<Role, TestUser>;

const tool = (overrides: Record<string, unknown> = {}) => ({
  name: "crear_ticket",
  description: "Crea un ticket de soporte en n8n con el problema del cliente.",
  method: "POST",
  url: "https://n8n.example.com/webhook/ticket",
  timeoutSeconds: 10,
  parameters: [{ name: "problema", type: "string", description: "Qué le pasa al cliente", required: true }],
  headers: [{ name: "Authorization", value: `Bearer ${SECRET}` }],
  ...overrides,
});

async function saved(): Promise<string> {
  state.actor = users.owner.actor;
  const result = await saveCustomToolAction({ tool: tool() });
  if (!result.ok || !result.data) throw new Error("not saved");
  return result.data.id;
}

beforeAll(async () => {
  await createBusiness();
  for (const role of ["owner", "admin", "supervisor", "agent", "viewer"] as const) users[role] = await createUser(role);
});

beforeEach(async () => {
  state.actor = users.owner.actor;
  state.calls = [];
  for (const table of [agentCustomTools, customTools, auditLog, rateLimits]) await db.delete(table);
  await db.delete(agents);
});

describe("Herramientas HTTP actions: owner and admin only [PER-01] [SEG-04]", () => {
  it("without a session or with another role nothing is created, changed, deleted or called", async () => {
    const id = await saved();
    state.actor = null;
    expect(await saveCustomToolAction({ tool: tool({ name: "sin_sesion" }) })).toEqual({ ok: false, error: "Tu sesión ha caducado. Vuelve a entrar." });
    for (const role of ["supervisor", "agent", "viewer"] as const) {
      state.actor = users[role].actor;
      expect(await saveCustomToolAction({ tool: tool({ name: `de_${role}` }) })).toEqual(FORBIDDEN);
      expect(await saveCustomToolAction({ toolId: id, tool: tool({ description: "Cambiada por otro rol." }) })).toEqual(FORBIDDEN);
      expect(await deleteCustomToolAction({ toolId: id, confirmInUse: true })).toEqual(FORBIDDEN);
      expect(await testCustomToolAction({ toolId: id, args: { problema: "No funciona" } })).toEqual(FORBIDDEN);
    }
    const rows = await db.select().from(customTools);
    expect(rows.map((row) => row.description)).toEqual(["Crea un ticket de soporte en n8n con el problema del cliente."]);
    expect(state.calls).toHaveLength(0);
  });

  it("the admin creates, edits, tests and deletes", async () => {
    state.actor = users.admin.actor;
    const created = await saveCustomToolAction({ tool: tool() });
    expect(created).toMatchObject({ ok: true, message: "Herramienta creada." });
    const id = created.ok && created.data ? created.data.id : "";
    expect(await saveCustomToolAction({ toolId: id, tool: tool({ headers: [{ name: "Authorization", keep: "Authorization" }] }) })).toMatchObject({ ok: true });
    expect(await testCustomToolAction({ toolId: id, args: { problema: "No funciona" } })).toMatchObject({ ok: true, data: { ok: true, status: 200 } });
    expect(await deleteCustomToolAction({ toolId: id })).toMatchObject({ ok: true });
    expect(await db.select().from(customTools)).toHaveLength(0);
  });
});

describe("secrets never come back [HER-12] [SEG-02]", () => {
  it("saving answers with the id only; «Probar» answers with status, time and response, the echoed secret removed", async () => {
    state.actor = users.owner.actor;
    const created = await saveCustomToolAction({ tool: tool() });
    expect(created).toEqual({ ok: true, data: { id: expect.any(String) }, message: "Herramienta creada." });
    const id = created.ok && created.data ? created.data.id : "";

    const result = await testCustomToolAction({ toolId: id, args: { problema: "No me llegan los correos" } });
    expect(result).toMatchObject({ ok: true, data: { ok: true, status: 200, error: null } });
    expect(result.ok && result.data?.response).toContain("[redactado]");
    expect(JSON.stringify(result)).not.toContain(SECRET);
    // The service did get it.
    expect(state.calls[0].headers.get("authorization")).toBe(`Bearer ${SECRET}`);
  });

  it("wrong fields come back by name, in Spanish, without the values typed", async () => {
    state.actor = users.owner.actor;
    const result = await saveCustomToolAction({ tool: tool({ url: "http://n8n.example.com/webhook/ticket", headers: [{ name: "Host", value: SECRET }] }) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors?.["headers.0.name"]?.[0]).toMatch(/la pone la app/);
    expect(JSON.stringify(result)).not.toContain(SECRET);
    const url = await saveCustomToolAction({ tool: tool({ url: "http://n8n.example.com/webhook/ticket" }) });
    expect(!url.ok && url.fieldErrors?.url?.[0]).toMatch(/https:\/\//);
  });

  it("«Probar» with a wrong sample value says which one", async () => {
    const id = await saved();
    const result = await testCustomToolAction({ toolId: id, args: {} });
    expect(result).toEqual({ ok: false, error: "Revisa los campos marcados.", fieldErrors: { problema: ["Falta este dato."] } });
    expect(state.calls).toHaveLength(0);
  });
});

describe("delete warns when agents use it [AGE-08]", () => {
  it("without confirming, the answer names the agents and nothing is deleted", async () => {
    const id = await saved();
    const [agent] = await db.insert(agents).values({ name: "Soporte", instructions: {}, handoff: {} }).returning();
    await db.insert(agentCustomTools).values({ agentId: agent.id, customToolId: id });
    expect(await deleteCustomToolAction({ toolId: id })).toEqual({ ok: false, error: "La usan Soporte. Si la borras, esos agentes dejarán de tenerla." });
    expect(await db.select().from(customTools).where(eq(customTools.id, id))).toHaveLength(1);
    expect(await deleteCustomToolAction({ toolId: id, confirmInUse: true })).toMatchObject({ ok: true });
    expect(await db.select().from(customTools)).toHaveLength(0);
  });

  it("a malformed request is «not found»", async () => {
    expect(await deleteCustomToolAction({ toolId: "x" })).toEqual({ ok: false, error: "No se ha encontrado la herramienta." });
    expect(await testCustomToolAction({ toolId: crypto.randomUUID(), args: {} })).toEqual({ ok: false, error: "No se ha encontrado la herramienta." });
  });
});
