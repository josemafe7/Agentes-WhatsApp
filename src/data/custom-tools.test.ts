import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { agentCustomTools, agents, auditLog, customTools, rateLimits } from "@/db/schema";
import type { Role } from "@/lib/enums";
import type { HttpToolDeps } from "@/server/ai/tools/http-tool";
import { decryptSecret, encryptSecret } from "@/server/crypto";
import { AuthError, ConflictError, NotFoundError, RateLimitError, ValidationError } from "@/server/errors";
import { createAgentRow, createBusiness, createUser, type TestUser } from "@/test/factories";
import {
  createCustomTool,
  deleteCustomTool,
  getCustomTool,
  HTTP_TOOL_TEST_LIMIT,
  listAgentCustomTools,
  listCustomTools,
  setAgentCustomTool,
  testCustomTool,
  updateCustomTool,
} from "./custom-tools";

const SECRET = "sk-live-crm-0011223344556677";
const OTHER_SECRET = "otra-clave-muy-secreta-9988";
const users = {} as Record<Role, TestUser>;
const NOT_MANAGERS = ["supervisor", "agent", "viewer"] as const;

const input = (overrides: Record<string, unknown> = {}) => ({
  name: "consultar_pedido",
  description: "Consulta el estado de un pedido por su número.",
  method: "GET",
  url: "https://crm.example.com/pedidos/{numero}",
  timeoutSeconds: 10,
  parameters: [{ name: "numero", type: "string", description: "Número del pedido", required: true }],
  headers: [{ name: "X-Api-Key", value: SECRET }],
  ...overrides,
});

/** A fake CRM behind a public address. */
function fakeCrm(answer: (url: string, init: RequestInit) => Response = () => Response.json({ pedido: "42", estado: "En reparto" })) {
  const calls: { url: string; init: RequestInit }[] = [];
  const deps: HttpToolDeps = {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return answer(url, init);
    },
    resolveHost: async () => [{ address: "93.184.215.14", family: 4 }],
    allowLocal: false,
  };
  return { deps, calls };
}

async function fieldErrors(promise: Promise<unknown>): Promise<Record<string, string[]>> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ValidationError);
  return (error as ValidationError).fieldErrors ?? {};
}

async function storedRow(id: string) {
  const [row] = await db.select().from(customTools).where(eq(customTools.id, id));
  return row;
}

beforeAll(async () => {
  await createBusiness();
  for (const role of ["owner", "admin", "supervisor", "agent", "viewer"] as const) users[role] = await createUser(role);
});

beforeEach(async () => {
  for (const table of [agentCustomTools, customTools, auditLog, rateLimits]) await db.delete(table);
  await db.delete(agents);
});

describe("who can manage HTTP tools: owner and admin only [PER-01] (spec «Agentes: herramientas HTTP personalizadas»)", () => {
  it("supervisor, agent and viewer get «not allowed» everywhere and nothing changes", async () => {
    const { id } = await createCustomTool(users.owner.actor, input());
    const agent = await createAgentRow();
    const crm = fakeCrm();
    for (const role of NOT_MANAGERS) {
      const actor = users[role].actor;
      await expect(listCustomTools(actor)).rejects.toBeInstanceOf(AuthError);
      await expect(getCustomTool(actor, id)).rejects.toBeInstanceOf(AuthError);
      await expect(createCustomTool(actor, input({ name: `de_${role}` }))).rejects.toBeInstanceOf(AuthError);
      await expect(updateCustomTool(actor, id, input({ description: "Cambiada" }))).rejects.toBeInstanceOf(AuthError);
      await expect(deleteCustomTool(actor, id, { confirmInUse: true })).rejects.toBeInstanceOf(AuthError);
      await expect(testCustomTool(actor, id, { numero: "42" }, crm.deps)).rejects.toBeInstanceOf(AuthError);
      await expect(listAgentCustomTools(actor, agent.id)).rejects.toBeInstanceOf(AuthError);
      await expect(setAgentCustomTool(actor, { agentId: agent.id, toolId: id, attached: true })).rejects.toBeInstanceOf(AuthError);
    }
    expect(crm.calls).toHaveLength(0);
    expect(await db.select().from(customTools)).toHaveLength(1);
    expect((await storedRow(id)).description).toBe("Consulta el estado de un pedido por su número.");
    expect(await db.select().from(agentCustomTools)).toHaveLength(0);
  });

  it("the admin can do everything the owner can", async () => {
    const { id } = await createCustomTool(users.admin.actor, input());
    await updateCustomTool(users.admin.actor, id, input({ description: "Otra descripción." }));
    expect((await getCustomTool(users.admin.actor, id)).description).toBe("Otra descripción.");
    await deleteCustomTool(users.admin.actor, id);
    expect(await listCustomTools(users.admin.actor)).toEqual([]);
  });
});

describe("a tool defined on screen [HER-11]", () => {
  it("is saved with its parameters for the model, its method, address and timeout, and appears in the list", async () => {
    const { id } = await createCustomTool(users.owner.actor, input({ timeoutSeconds: 20 }));
    const row = await storedRow(id);
    expect(row).toMatchObject({
      name: "consultar_pedido",
      method: "GET",
      url: "https://crm.example.com/pedidos/{numero}",
      timeoutMs: 20_000,
      parameters: { type: "object", properties: { numero: { type: "string", description: "Número del pedido" } }, required: ["numero"] },
    });
    const [item] = await listCustomTools(users.owner.actor);
    expect(item).toMatchObject({ id, name: "consultar_pedido", method: "GET", host: "crm.example.com", parameterCount: 1, headerNames: ["X-Api-Key"], agents: [] });
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, "custom_tool.created"));
    expect(entry).toMatchObject({ actorUserId: users.owner.userId, targetType: "custom_tool", targetId: id });
    expect(JSON.stringify(entry)).not.toContain(SECRET);
  });

  it("wrong data is not saved and each field says why, in Spanish [AGE-15]", async () => {
    expect((await fieldErrors(createCustomTool(users.owner.actor, input({ name: "crear_cita" })))).name?.[0]).toMatch(/herramienta del sistema/);
    expect((await fieldErrors(createCustomTool(users.owner.actor, input({ url: "http://crm.example.com/pedidos/{numero}" })))).url?.[0]).toMatch(/https:\/\//);
    expect((await fieldErrors(createCustomTool(users.owner.actor, input({ url: "https://crm.example.com/{otro}" })))).url?.[0]).toMatch(/\{otro\}/);
    expect((await fieldErrors(createCustomTool(users.owner.actor, input({ headers: [{ name: "Authorization" }] }))))["headers.0.value"]?.[0]).toMatch(/valor/);
    expect(
      (await fieldErrors(createCustomTool(users.owner.actor, input({ parameters: [{ name: "numero", type: "string", required: true }, { name: "numero", type: "number" }] }))))[
        "parameters.1.name"
      ],
    ).toBeDefined();
    expect(await db.select().from(customTools)).toHaveLength(0);
  });

  it("only public servers [HER-14]: an internal address or «localhost» is refused when saving", async () => {
    for (const url of ["https://127.0.0.1/x", "https://169.254.169.254/latest", "https://[::1]/x", "https://10.0.0.8/x", "https://localhost/x", "https://api.localhost/x"]) {
      expect((await fieldErrors(createCustomTool(users.owner.actor, input({ url, parameters: [] })))).url?.[0], url).toMatch(/servicios públicos/);
    }
  });

  it("names are unique", async () => {
    await createCustomTool(users.owner.actor, input());
    expect((await fieldErrors(createCustomTool(users.owner.actor, input({ name: "Consultar_Pedido" })))).name?.[0]).toMatch(/Ya hay una herramienta/);
  });
});

describe("secret headers: encrypted, never whole, replaced only with «Cambiar» [HER-12] [SEG-01] [SEG-02] [PER-07]", () => {
  it("are stored encrypted and read back only masked «••••1234»", async () => {
    const { id } = await createCustomTool(users.owner.actor, input({ headers: [{ name: "X-Api-Key", value: SECRET }, { name: "X-Corto", value: "abc12" }] }));
    const row = await storedRow(id);
    expect(row.secretHeadersEnc).toMatch(/^v1:/);
    expect(row.secretHeadersEnc).not.toContain(SECRET);
    expect(JSON.parse(decryptSecret(row.secretHeadersEnc ?? ""))).toEqual({ "X-Api-Key": SECRET, "X-Corto": "abc12" });
    expect(row.headers).toEqual({});

    const detail = await getCustomTool(users.owner.actor, id);
    expect(detail.headers).toEqual([
      { name: "X-Api-Key", masked: "••••6677" },
      { name: "X-Corto", masked: "••••" },
    ]);
    expect(detail.headersReadable).toBe(true);
    expect(JSON.stringify(detail)).not.toContain(SECRET);
    expect(JSON.stringify(await listCustomTools(users.owner.actor))).not.toContain(SECRET);
  });

  it("a header not changed keeps its value; «Cambiar» replaces it; one left out is removed; renaming keeps the value", async () => {
    const { id } = await createCustomTool(users.owner.actor, input({ headers: [{ name: "X-Api-Key", value: SECRET }, { name: "X-Cuenta", value: "cuenta-1234567" }] }));
    await updateCustomTool(users.owner.actor, id, input({ description: "Nueva.", headers: [{ name: "X-Api-Key", keep: "X-Api-Key" }] }));
    expect(JSON.parse(decryptSecret((await storedRow(id)).secretHeadersEnc ?? ""))).toEqual({ "X-Api-Key": SECRET });

    await updateCustomTool(users.owner.actor, id, input({ headers: [{ name: "Authorization", keep: "X-Api-Key" }] }));
    expect(JSON.parse(decryptSecret((await storedRow(id)).secretHeadersEnc ?? ""))).toEqual({ Authorization: SECRET });

    await updateCustomTool(users.owner.actor, id, input({ headers: [{ name: "Authorization", keep: "Authorization", value: OTHER_SECRET }] }));
    expect(JSON.parse(decryptSecret((await storedRow(id)).secretHeadersEnc ?? ""))).toEqual({ Authorization: OTHER_SECRET });

    await updateCustomTool(users.owner.actor, id, input({ headers: [] }));
    expect((await storedRow(id)).secretHeadersEnc).toBeNull();
  });

  it("a saved secret only goes back to the address it was saved for: any change of the address needs it typed again (docs/security.md)", async () => {
    const { id } = await createCustomTool(users.owner.actor, input());
    const keep = [{ name: "X-Api-Key", keep: "X-Api-Key" }];
    for (const url of [
      "https://atacante.example.org/pedidos/{numero}",
      // Same server, another path: on a shared host (a webhook service, an n8n) that may be someone else's endpoint.
      "https://crm.example.com/v2/pedidos/{numero}",
      "https://crm.example.com/pedidos/{numero}?origen=web",
    ]) {
      expect((await fieldErrors(updateCustomTool(users.owner.actor, id, input({ url, headers: keep }))))["headers.0.value"]?.[0], url).toMatch(/vuelve a escribir/);
      expect((await storedRow(id)).url).toBe("https://crm.example.com/pedidos/{numero}");
    }
    // The same address: the value is kept.
    await updateCustomTool(users.owner.actor, id, input({ description: "Otra descripción.", headers: keep }));
    expect(JSON.parse(decryptSecret((await storedRow(id)).secretHeadersEnc ?? ""))).toEqual({ "X-Api-Key": SECRET });
    // Another address with the value typed again: saved.
    await updateCustomTool(users.owner.actor, id, input({ url: "https://crm2.example.com/pedidos/{numero}", headers: [{ name: "X-Api-Key", value: OTHER_SECRET }] }));
    expect(JSON.parse(decryptSecret((await storedRow(id)).secretHeadersEnc ?? ""))).toEqual({ "X-Api-Key": OTHER_SECRET });
  });

  it("headers that cannot be read (the key changed) are flagged and must be typed again [SEG-03]", async () => {
    const { id } = await createCustomTool(users.owner.actor, input());
    await db.update(customTools).set({ secretHeadersEnc: encryptSecret("{roto") }).where(eq(customTools.id, id));
    const detail = await getCustomTool(users.owner.actor, id);
    expect(detail).toMatchObject({ headers: [], headersReadable: false });
    expect((await fieldErrors(updateCustomTool(users.owner.actor, id, input({ headers: [{ name: "X-Api-Key", keep: "X-Api-Key" }] }))))["headers.0.value"]?.[0]).toMatch(
      /no se puede leer/,
    );
    await updateCustomTool(users.owner.actor, id, input({ headers: [{ name: "X-Api-Key", value: OTHER_SECRET }] }));
    expect((await getCustomTool(users.owner.actor, id)).headersReadable).toBe(true);
  });
});

describe("delete: warns when agents use it [AGE-08]", () => {
  it("unused: deleted and logged", async () => {
    const { id } = await createCustomTool(users.owner.actor, input());
    await deleteCustomTool(users.owner.actor, id);
    expect(await db.select().from(customTools)).toHaveLength(0);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "custom_tool.deleted"))).toHaveLength(1);
  });

  it("in use: refused with the agents' names until confirmed; then it leaves those agents", async () => {
    const { id } = await createCustomTool(users.owner.actor, input());
    const reception = await createAgentRow({ name: "Recepción" });
    const sales = await createAgentRow({ name: "Ventas" });
    await setAgentCustomTool(users.owner.actor, { agentId: reception.id, toolId: id, attached: true });
    await setAgentCustomTool(users.owner.actor, { agentId: sales.id, toolId: id, attached: true });
    expect((await getCustomTool(users.owner.actor, id)).agents.map((agent) => agent.name)).toEqual(["Recepción", "Ventas"]);

    const refused = await deleteCustomTool(users.owner.actor, id).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ConflictError);
    expect((refused as ConflictError).userMessage).toMatch(/Recepción, Ventas/);
    expect(await db.select().from(customTools)).toHaveLength(1);

    await deleteCustomTool(users.owner.actor, id, { confirmInUse: true });
    expect(await db.select().from(customTools)).toHaveLength(0);
    expect(await db.select().from(agentCustomTools)).toHaveLength(0);
    await expect(getCustomTool(users.owner.actor, id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("«Probar» with sample values [HER-11] [HER-12] [HER-13]", () => {
  it("runs on the server and returns status, time and the answer, never the secret headers; it is logged", async () => {
    const { id } = await createCustomTool(users.owner.actor, input());
    const crm = fakeCrm((_url, init) => Response.json({ pedido: "42", estado: "En reparto", eco: new Headers(init.headers).get("x-api-key") }));
    const result = await testCustomTool(users.owner.actor, id, { numero: "42" }, crm.deps);
    expect(result).toMatchObject({ ok: true, status: 200, error: null, truncated: false });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.response).toContain("En reparto");
    expect(result.response).toContain("[redactado]");
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(crm.calls[0].url).toBe("https://crm.example.com/pedidos/42");
    expect(new Headers(crm.calls[0].init.headers).get("x-api-key")).toBe(SECRET);

    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, "custom_tool.tested"));
    expect(entry).toMatchObject({ actorType: "user", actorUserId: users.owner.userId, targetId: id, metadata: { tool: "consultar_pedido", status: 200, ok: true, host: "crm.example.com" } });
    expect(JSON.stringify(entry)).not.toContain(SECRET);
    expect(JSON.stringify(entry)).not.toContain("En reparto");
  });

  it("the sample values are checked like the model's: each wrong one says why, and nothing is called", async () => {
    const { id } = await createCustomTool(
      users.owner.actor,
      input({ parameters: [{ name: "numero", type: "string", required: true }, { name: "unidades", type: "number" }], headers: [] }),
    );
    const crm = fakeCrm();
    const errors = await fieldErrors(testCustomTool(users.owner.actor, id, { unidades: "tres" }, crm.deps));
    expect(errors).toEqual({ numero: ["Falta este dato."], unidades: ["Tiene que ser un número."] });
    expect(crm.calls).toHaveLength(0);
  });

  it("a failure is explained in Spanish (error, timeout, redirect…)", async () => {
    const { id } = await createCustomTool(users.owner.actor, input());
    const result = await testCustomTool(users.owner.actor, id, { numero: "42" }, fakeCrm(() => new Response(null, { status: 302, headers: { location: "https://otro.example.org" } })).deps);
    expect(result).toMatchObject({ ok: false, status: 302, error: expect.stringMatching(/redirección/) });
  });

  it("has a per-person limit, because each test calls an outside service [SEG-07]", async () => {
    const { id } = await createCustomTool(users.owner.actor, input({ headers: [] }));
    const crm = fakeCrm();
    for (let index = 0; index < HTTP_TOOL_TEST_LIMIT; index += 1) await testCustomTool(users.owner.actor, id, { numero: "1" }, crm.deps);
    await expect(testCustomTool(users.owner.actor, id, { numero: "1" }, crm.deps)).rejects.toBeInstanceOf(RateLimitError);
    expect(crm.calls).toHaveLength(HTTP_TOOL_TEST_LIMIT);
    // Another person has their own.
    await testCustomTool(users.admin.actor, id, { numero: "1" }, crm.deps);
  });
});

describe("attach and detach per agent (the agent's Herramientas tab) [AGE-08]", () => {
  it("lists every tool with whether the agent uses it; switching changes only that agent", async () => {
    const reception = await createAgentRow({ name: "Recepción" });
    const sales = await createAgentRow({ name: "Ventas" });
    const { id } = await createCustomTool(users.owner.actor, input());
    const { id: other } = await createCustomTool(users.owner.actor, input({ name: "crear_ticket", method: "POST", url: "https://n8n.example.com/webhook/ticket" }));

    expect(await setAgentCustomTool(users.owner.actor, { agentId: reception.id, toolId: id, attached: true })).toEqual({ toolName: "consultar_pedido" });
    await setAgentCustomTool(users.owner.actor, { agentId: reception.id, toolId: id, attached: true });
    expect((await listAgentCustomTools(users.owner.actor, reception.id)).map(({ name, attached }) => ({ name, attached }))).toEqual([
      { name: "consultar_pedido", attached: true },
      { name: "crear_ticket", attached: false },
    ]);
    expect((await listAgentCustomTools(users.owner.actor, sales.id)).every((tool) => !tool.attached)).toBe(true);

    await setAgentCustomTool(users.admin.actor, { agentId: reception.id, toolId: id, attached: false });
    expect(await db.select().from(agentCustomTools)).toHaveLength(0);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "agent.custom_tools_changed"))).toHaveLength(3);
    expect(other).toBeTruthy();
  });

  it("an unknown agent or tool is «not found»", async () => {
    const agent = await createAgentRow();
    const { id } = await createCustomTool(users.owner.actor, input());
    await expect(setAgentCustomTool(users.owner.actor, { agentId: crypto.randomUUID(), toolId: id, attached: true })).rejects.toBeInstanceOf(NotFoundError);
    await expect(setAgentCustomTool(users.owner.actor, { agentId: agent.id, toolId: crypto.randomUUID(), attached: true })).rejects.toBeInstanceOf(NotFoundError);
    await expect(listAgentCustomTools(users.owner.actor, crypto.randomUUID())).rejects.toBeInstanceOf(NotFoundError);
    await expect(getCustomTool(users.owner.actor, "no-es-un-id")).rejects.toBeInstanceOf(NotFoundError);
  });
});
