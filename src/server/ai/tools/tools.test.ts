import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { registerHandoffService, unregisterHandoffService, type HandoffRequest } from "@/server/handoff";
import { defineTool, executeToolCall, MAX_TOOL_RESULT_CHARS, skipToolCalls, toolDefinitions, toolsForAgent, type ToolContext } from "./index";

const context = (overrides: Partial<ToolContext> = {}): ToolContext => ({
  mode: "test",
  agentId: crypto.randomUUID(),
  conversationId: null,
  contactId: null,
  channelId: null,
  now: new Date("2026-09-29T08:00:00Z"),
  timezone: "Europe/Madrid",
  withinBusinessHours: true,
  handoff: { messageInHours: "Te paso con Marta ahora mismo.", messageOffHours: "Estamos cerrados; te escribimos mañana." },
  ...overrides,
});

const call = (name: string, args: unknown, id = "call_1") => ({
  id,
  type: "function" as const,
  function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) },
});

const handoffArgs = { motivo: "Pide hablar con una persona", resumen: "Quiere cambiar una cita de la semana pasada.", urgencia: "alta" };

beforeEach(async () => {
  await db.delete(auditLog);
});

afterEach(() => {
  unregisterHandoffService();
});

describe("tools an agent gets [AGE-08] [HER-10]", () => {
  it("the hand-off is always on; the knowledge search (phase 4) and the booking tools (phase 5) only when enabled", () => {
    expect([...toolsForAgent([]).keys()]).toEqual(["transferir_a_humano"]);
    expect([...toolsForAgent(["crear_cita", "buscar_conocimiento", "transferir_a_humano"]).keys()]).toEqual(["transferir_a_humano", "buscar_conocimiento", "crear_cita"]);
    expect([...toolsForAgent(["herramienta_inventada"]).keys()]).toEqual(["transferir_a_humano"]);
  });

  it("the model sees each tool as a function with the JSON Schema of its Zod parameters", () => {
    const [definition] = toolDefinitions(toolsForAgent([]));
    expect(definition.type).toBe("function");
    expect(definition.function.name).toBe("transferir_a_humano");
    expect(definition.function.parameters).toMatchObject({
      type: "object",
      properties: { motivo: { type: "string" }, resumen: { type: "string" }, urgencia: { enum: ["baja", "normal", "alta"] } },
      required: ["motivo", "resumen", "urgencia"],
    });
    expect(definition.function.parameters).not.toHaveProperty("$schema");
  });
});

describe("every call is checked and logged [HER-02] [HER-03] [SEG-10]", () => {
  it("invalid arguments return a short error to the model and nothing runs", async () => {
    const execute = vi.fn();
    const tool = defineTool({ name: "prueba", description: "Prueba", parameters: z.object({ n: z.number({ error: "Tiene que ser un número." }) }), execute });
    const tools = new Map([[tool.name, tool]]);
    const outcome = await executeToolCall(tools, call("prueba", { n: "tres" }), context());
    expect(execute).not.toHaveBeenCalled();
    expect(outcome.record).toMatchObject({ name: "prueba", ok: false, arguments: { n: "tres" } });
    expect(outcome.record.result.error).toBe("Datos no válidos: n: Tiene que ser un número.");
    expect(JSON.parse(outcome.message.content)).toEqual(outcome.record.result);
    expect(outcome.message.tool_call_id).toBe("call_1");

    const broken = await executeToolCall(tools, call("prueba", "{no es json"), context());
    expect(broken.record.result.error).toMatch(/JSON/);
    const unknown = await executeToolCall(tools, call("borrar_todo", {}), context());
    expect(unknown.record.result.error).toMatch(/no está disponible/);
    expect(execute).not.toHaveBeenCalled();
  });

  it("logs each use with actor «ai», the tool and the outcome, never the arguments", async () => {
    const ctx = context({ conversationId: null });
    await executeToolCall(toolsForAgent([]), call("transferir_a_humano", handoffArgs), ctx);
    const [entry] = await db.select().from(auditLog);
    expect(entry).toMatchObject({ actorType: "ai", action: "ai.tool_called", targetType: "agent", targetId: ctx.agentId });
    expect(entry.metadata).toEqual({ tool: "transferir_a_humano", ok: true, mode: "test", agentId: ctx.agentId });
    expect(JSON.stringify(entry)).not.toContain("cambiar una cita");
  });

  it("a tool the agent does not have is recorded as «desconocida»; what the model wrote is kept apart and cut short [HER-09]", async () => {
    const invented = `<script>${"x".repeat(500)}`;
    const outcome = await executeToolCall(toolsForAgent([]), call(invented, {}), context());
    expect(outcome.record).toMatchObject({ name: "desconocida", ok: false });
    const [entry] = await db.select().from(auditLog);
    expect(entry.metadata).toMatchObject({ tool: "desconocida", requested: invented.slice(0, 64), ok: false, error: "unavailable" });
  });

  it("calls that are not run get their short error and a single entry in the log", async () => {
    const ctx = context();
    const answers = await skipToolCalls([call("a", {}, "c1"), call("b", {}, "c2"), call("c", {}, "c3")], "too_many", ctx);
    expect(answers.map((answer) => answer.tool_call_id)).toEqual(["c1", "c2", "c3"]);
    expect(JSON.parse(answers[0].content)).toEqual({ ok: false, error: "No ejecutada: demasiadas herramientas en una sola respuesta." });
    const entries = await db.select().from(auditLog);
    expect(entries).toEqual([
      expect.objectContaining({ actorType: "ai", action: "ai.tool_calls_skipped", metadata: { reason: "too_many", count: 3, mode: "test", agentId: ctx.agentId } }),
    ]);
    expect(await skipToolCalls([], "handed_off", ctx)).toEqual([]);
    expect(await db.select().from(auditLog)).toHaveLength(1);
  });

  it("an unexpected failure reaches the model as a generic message; results are kept short", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failing = defineTool({
      name: "falla",
      description: "Falla",
      parameters: z.object({}),
      execute: async () => {
        throw new Error("SQLITE_BUSY at /secret/path token=abc");
      },
    });
    const outcome = await executeToolCall(new Map([[failing.name, failing]]), call("falla", {}), context());
    expect(outcome.record.result).toEqual({ ok: false, error: "La herramienta ha fallado. Inténtalo de otra forma o pasa con una persona." });

    const chatty = defineTool({ name: "larga", description: "Larga", parameters: z.object({}), execute: async () => ({ result: { ok: true, text: "x".repeat(10_000) } }) });
    const long = await executeToolCall(new Map([[chatty.name, chatty]]), call("larga", {}), context());
    expect(long.message.content.length).toBeLessThanOrEqual(MAX_TOOL_RESULT_CHARS + 1);
  });
});

describe("transferir_a_humano [HER-08] [TRA-03]", () => {
  const tools = toolsForAgent([]);

  it("in «Probar agente» it simulates the hand-off and ends the turn with the in-hours message", async () => {
    const outcome = await executeToolCall(tools, call("transferir_a_humano", handoffArgs), context());
    expect(outcome.record.result).toEqual({ ok: true, simulado: true, estado: "pendiente_de_humano", mensaje_al_cliente: "Te paso con Marta ahora mismo." });
    expect(outcome.reply).toBe("Te paso con Marta ahora mismo.");
  });

  it("outside opening hours the reply is the off-hours message, with a default when the agent has none", async () => {
    expect((await executeToolCall(tools, call("transferir_a_humano", handoffArgs), context({ withinBusinessHours: false }))).reply).toBe(
      "Estamos cerrados; te escribimos mañana.",
    );
    const fallback = await executeToolCall(tools, call("transferir_a_humano", handoffArgs), context({ withinBusinessHours: false, handoff: {} }));
    expect(fallback.reply).toMatch(/estamos cerrados/i);
  });

  it("checks its data: without a summary nothing is handed off [HER-02]", async () => {
    const outcome = await executeToolCall(tools, call("transferir_a_humano", { motivo: "x", urgencia: "urgentísima" }), context());
    expect(outcome.record.ok).toBe(false);
    expect(outcome.reply).toBeUndefined();
    expect(outcome.record.result.error).toMatch(/resumen/);
  });

  it("live, without the inbox's hand-off service it fails clearly and changes nothing", async () => {
    const outcome = await executeToolCall(tools, call("transferir_a_humano", handoffArgs), context({ mode: "live", conversationId: crypto.randomUUID() }));
    expect(outcome.record.result).toEqual({ ok: false, error: "El traspaso a una persona todavía no está disponible en esta instalación." });
    expect(outcome.reply).toBeUndefined();
  });

  it("live, it asks the registered service with the reason, summary and urgency of the model", async () => {
    const requests: HandoffRequest[] = [];
    registerHandoffService({
      async requestHandoff(request) {
        requests.push(request);
        return { handoffId: crypto.randomUUID(), assignedUserId: null };
      },
    });
    const ctx = context({ mode: "live", conversationId: crypto.randomUUID() });
    const outcome = await executeToolCall(tools, call("transferir_a_humano", handoffArgs), ctx);
    expect(requests).toEqual([
      expect.objectContaining({
        conversationId: ctx.conversationId,
        agentId: ctx.agentId,
        trigger: "ai_tool",
        reason: "Pide hablar con una persona",
        summary: "Quiere cambiar una cita de la semana pasada.",
        urgency: "high",
        customerMessage: "Te paso con Marta ahora mismo.",
      }),
    ]);
    expect(outcome.reply).toBe("Te paso con Marta ahora mismo.");
    const [entry] = await db.select().from(auditLog);
    expect(entry).toMatchObject({ targetType: "conversation", targetId: ctx.conversationId });
  });
});
