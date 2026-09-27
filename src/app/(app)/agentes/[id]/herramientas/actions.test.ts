import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createCustomTool } from "@/data/custom-tools";
import { db } from "@/db";
import { agentCustomTools, agents, auditLog, customTools } from "@/db/schema";
import type { Role } from "@/lib/enums";
import type { Actor } from "@/lib/permissions";
import { createAgentRow, createBusiness, createUser, type TestUser } from "@/test/factories";

const state = vi.hoisted(() => ({ actor: null as Actor | null }));

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

import { setAgentCustomToolAction } from "./actions";

const users = {} as Record<Role, TestUser>;
let agentId = "";
let toolId = "";

beforeAll(async () => {
  await createBusiness();
  for (const role of ["owner", "admin", "supervisor", "agent", "viewer"] as const) users[role] = await createUser(role);
});

beforeEach(async () => {
  state.actor = users.owner.actor;
  for (const table of [agentCustomTools, customTools, auditLog]) await db.delete(table);
  await db.delete(agents);
  agentId = (await createAgentRow({ name: "Recepción" })).id;
  toolId = (
    await createCustomTool(users.owner.actor, {
      name: "consultar_pedido",
      description: "Consulta un pedido.",
      method: "GET",
      url: "https://crm.example.com/pedidos",
      timeoutSeconds: 10,
    })
  ).id;
});

describe("attach and detach a custom HTTP tool in the agent's Herramientas tab [AGE-08] [PER-01]", () => {
  it("owner and admin switch it on and off; the answer says what changed", async () => {
    expect(await setAgentCustomToolAction({ agentId, toolId, attached: true })).toEqual({ ok: true, message: "Este agente ya puede usar «consultar_pedido»." });
    expect(await db.select().from(agentCustomTools)).toHaveLength(1);
    state.actor = users.admin.actor;
    expect(await setAgentCustomToolAction({ agentId, toolId, attached: false })).toEqual({ ok: true, message: "Este agente ya no usa «consultar_pedido»." });
    expect(await db.select().from(agentCustomTools)).toHaveLength(0);
  });

  it("supervisor, agent and viewer are refused and nothing changes; without a session too", async () => {
    for (const role of ["supervisor", "agent", "viewer"] as const) {
      state.actor = users[role].actor;
      expect(await setAgentCustomToolAction({ agentId, toolId, attached: true })).toEqual({ ok: false, error: "No tienes permiso para hacer esto." });
    }
    state.actor = null;
    expect(await setAgentCustomToolAction({ agentId, toolId, attached: true })).toEqual({ ok: false, error: "Tu sesión ha caducado. Vuelve a entrar." });
    expect(await db.select().from(agentCustomTools)).toHaveLength(0);
  });

  it("a malformed request or an unknown tool is «not found»", async () => {
    expect(await setAgentCustomToolAction({ agentId, toolId: "otra", attached: true })).toEqual({ ok: false, error: "No se ha encontrado la herramienta." });
    expect(await setAgentCustomToolAction({ agentId, toolId: crypto.randomUUID(), attached: true })).toEqual({ ok: false, error: "No se ha encontrado la herramienta." });
    expect(await setAgentCustomToolAction({ agentId: crypto.randomUUID(), toolId, attached: true })).toEqual({ ok: false, error: "No se ha encontrado el agente." });
  });
});
