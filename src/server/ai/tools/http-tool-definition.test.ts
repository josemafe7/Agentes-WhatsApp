import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  httpToolArgumentsSchema,
  httpToolInputSchema,
  parametersFromJsonSchema,
  parametersToJsonSchema,
  planHttpToolCall,
  templatePlaceholders,
  urlTemplateProblems,
  type HttpToolParameter,
} from "./http-tool-definition";

const param = (overrides: Partial<HttpToolParameter> & { name: string }): HttpToolParameter => ({
  type: "string",
  description: "",
  required: true,
  options: [],
  ...overrides,
});

const validInput = (overrides: Record<string, unknown> = {}) => ({
  name: "consultar_pedido",
  description: "Consulta el estado de un pedido por su número.",
  method: "GET",
  url: "https://crm.example.com/pedidos/{numero}",
  timeoutSeconds: 10,
  parameters: [{ name: "numero", type: "string", description: "Número del pedido", required: true }],
  headers: [{ name: "X-Api-Key", value: "clave-secreta-123456" }],
  ...overrides,
});

/** Messages of a failed parse, by the full path of the field ("parameters.0.name"). */
function issues(result: z.ZodSafeParseResult<unknown>): Record<string, string[]> {
  if (result.success) return {};
  const byPath: Record<string, string[]> = {};
  for (const issue of result.error.issues) (byPath[issue.path.join(".")] ??= []).push(issue.message);
  return byPath;
}

describe("a tool is defined on screen [HER-11]", () => {
  it("accepts name, description, parameters, method, address, secret headers and a timeout", () => {
    const result = httpToolInputSchema.safeParse(validInput());
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      name: "consultar_pedido",
      method: "GET",
      timeoutSeconds: 10,
      parameters: [{ name: "numero", type: "string", description: "Número del pedido", required: true, options: [] }],
      headers: [{ name: "X-Api-Key", value: "clave-secreta-123456" }],
    });
  });

  it("the name is snake_case, 3–64 characters, and never one of the system tools", () => {
    expect(httpToolInputSchema.safeParse(validInput({ name: "  Consultar_Pedido " })).data?.name).toBe("consultar_pedido");
    for (const name of ["consultar pedido", "1pedido", "consultar-pedido", "pedídos", "ab", "a".repeat(65)]) {
      expect(issues(httpToolInputSchema.safeParse(validInput({ name }))).name, name).toBeDefined();
    }
    for (const name of ["crear_cita", "transferir_a_humano", "buscar_conocimiento"]) {
      expect(issues(httpToolInputSchema.safeParse(validInput({ name }))).name?.[0]).toMatch(/herramienta del sistema/);
    }
  });

  it("needs a description for the AI, a known method and a timeout of 1 to 30 seconds (10 by default in the form)", () => {
    expect(issues(httpToolInputSchema.safeParse(validInput({ description: "  " }))).description?.[0]).toMatch(/para qué sirve/);
    expect(issues(httpToolInputSchema.safeParse(validInput({ method: "TRACE" }))).method).toBeDefined();
    expect(issues(httpToolInputSchema.safeParse(validInput({ timeoutSeconds: 0 }))).timeoutSeconds).toBeDefined();
    expect(issues(httpToolInputSchema.safeParse(validInput({ timeoutSeconds: 31 }))).timeoutSeconds?.[0]).toMatch(/30 segundos/);
    expect(issues(httpToolInputSchema.safeParse(validInput({ timeoutSeconds: 2.5 }))).timeoutSeconds).toBeDefined();
  });

  it("parameters: snake_case names without repeats, a known type, and at least one option for a list", () => {
    const repeated = httpToolInputSchema.safeParse(
      validInput({ parameters: [param({ name: "numero" }), param({ name: "numero" })], url: "https://crm.example.com/pedidos" }),
    );
    expect(issues(repeated)["parameters.1.name"]?.[0]).toMatch(/repetido/);
    expect(issues(httpToolInputSchema.safeParse(validInput({ parameters: [param({ name: "Número" })] })))["parameters.0.name"]).toBeDefined();
    expect(issues(httpToolInputSchema.safeParse(validInput({ parameters: [{ name: "numero", type: "date" }] })))["parameters.0.type"]).toBeDefined();
    const emptyList = httpToolInputSchema.safeParse(validInput({ parameters: [param({ name: "numero" }), param({ name: "tipo", type: "enum", options: [] })] }));
    expect(issues(emptyList)["parameters.1.options"]?.[0]).toMatch(/al menos una opción/);
    const list = httpToolInputSchema.safeParse(validInput({ parameters: [param({ name: "numero" }), param({ name: "tipo", type: "enum", options: [" urgente ", "normal"] })] }));
    expect(list.data?.parameters[1].options).toEqual(["urgente", "normal"]);
    // Options only belong to lists.
    const text = httpToolInputSchema.safeParse(validInput({ parameters: [param({ name: "numero", options: ["x"] })] }));
    expect(text.data?.parameters[0].options).toEqual([]);
  });

  it("secret headers: valid names, no repeats (in any case), none the app sets itself, printable values", () => {
    const headers = (list: unknown[]) => issues(httpToolInputSchema.safeParse(validInput({ headers: list })));
    expect(headers([{ name: "X Api Key", value: "abc12345" }])["headers.0.name"]).toBeDefined();
    expect(headers([{ name: "X-Api-Key", value: "abc12345" }, { name: "x-api-key", value: "def67890" }])["headers.1.name"]?.[0]).toMatch(/repetida/);
    for (const name of ["Host", "content-length", "Content-Type", "Transfer-Encoding", "Connection"]) {
      expect(headers([{ name, value: "abc12345" }])["headers.0.name"]?.[0], name).toMatch(/la pone la app/);
    }
    expect(headers([{ name: "Authorization", value: "Bearer abc\r\nX-Otra: 1" }])["headers.0.value"]).toBeDefined();
    expect(headers([{ name: "Authorization", value: "clave-con-tilde-é" }])["headers.0.value"]).toBeDefined();
    expect(httpToolInputSchema.safeParse(validInput({ headers: [{ name: "Authorization", value: "  Bearer abc123  " }] })).data?.headers[0].value).toBe(
      "Bearer abc123",
    );
  });
});

describe("the address template [HER-11] [HER-14]", () => {
  const params = [param({ name: "numero" }), param({ name: "email", required: false })];

  it("finds the {placeholders} in order, once each", () => {
    expect(templatePlaceholders("https://x.example.com/a/{numero}/b/{email}?n={numero}")).toEqual(["numero", "email"]);
    expect(templatePlaceholders("https://x.example.com/a")).toEqual([]);
  });

  it("a correct https address has no problems", () => {
    expect(urlTemplateProblems("https://crm.example.com/pedidos/{numero}?ver=completo", params, { allowLocal: false })).toEqual([]);
  });

  it("https only, outside local development [HER-14]", () => {
    expect(urlTemplateProblems("http://crm.example.com/pedidos/{numero}", params, { allowLocal: false }).join(" ")).toMatch(/https:\/\//);
    expect(urlTemplateProblems("http://localhost:5678/webhook/{numero}", params, { allowLocal: true })).toEqual([]);
    expect(urlTemplateProblems("ftp://crm.example.com/{numero}", params, { allowLocal: true }).join(" ")).toMatch(/https:\/\//);
    expect(urlTemplateProblems("crm.example.com/{numero}", params, { allowLocal: false }).join(" ")).toMatch(/completa/);
    expect(urlTemplateProblems("https:crm.example.com/{numero}", params, { allowLocal: false }).join(" ")).toMatch(/completa/);
  });

  it("no user or password in the address, no «#», and only the usual ports outside local development", () => {
    expect(urlTemplateProblems("https://yo:clave@crm.example.com/{numero}", params, { allowLocal: false }).join(" ")).toMatch(/usuario ni contraseña/);
    expect(urlTemplateProblems("https://crm.example.com/{numero}#arriba", params, { allowLocal: false }).join(" ")).toMatch(/#/);
    expect(urlTemplateProblems("https://crm.example.com:8443/{numero}", params, { allowLocal: false }).join(" ")).toMatch(/puerto/);
    expect(urlTemplateProblems("https://crm.example.com:443/{numero}", params, { allowLocal: false })).toEqual([]);
    expect(urlTemplateProblems("http://localhost:5678/{numero}", params, { allowLocal: true })).toEqual([]);
  });

  it("data only go in the path or the query, never in the server's name: the model must not choose where secrets go", () => {
    for (const template of ["https://{numero}.example.com/x", "https://crm.example.com:{numero}/x", "https://crm.{numero}/x", "https://{numero}/x"]) {
      expect(urlTemplateProblems(template, params, { allowLocal: true }).join(" "), template).toMatch(/nunca en el nombre del servidor/);
    }
  });

  it("every placeholder is a required parameter of the tool; stray braces are refused", () => {
    expect(urlTemplateProblems("https://crm.example.com/{pedido}", params, { allowLocal: false }).join(" ")).toMatch(/\{pedido\}/);
    expect(urlTemplateProblems("https://crm.example.com/{email}", params, { allowLocal: false }).join(" ")).toMatch(/obligatorio/);
    expect(urlTemplateProblems("https://crm.example.com/{numero", params, { allowLocal: false }).join(" ")).toMatch(/llaves/);
    expect(urlTemplateProblems("https://crm.example.com/{Numero}", params, { allowLocal: false }).join(" ")).toMatch(/llaves/);
  });
});

describe("parameters for the model and back [HER-11] [HER-02]", () => {
  const parameters: HttpToolParameter[] = [
    param({ name: "numero", description: "Número del pedido" }),
    param({ name: "cantidad", type: "number", required: false }),
    param({ name: "urgente", type: "boolean", required: false, description: "Si corre prisa" }),
    param({ name: "canal", type: "enum", options: ["web", "tienda"], description: "Dónde se hizo" }),
  ];

  it("become a JSON Schema object, stored as it is and read back the same, in the same order", () => {
    const schema = parametersToJsonSchema(parameters);
    expect(schema).toEqual({
      type: "object",
      properties: {
        numero: { type: "string", description: "Número del pedido" },
        cantidad: { type: "number" },
        urgente: { type: "boolean", description: "Si corre prisa" },
        canal: { type: "string", enum: ["web", "tienda"], description: "Dónde se hizo" },
      },
      required: ["numero", "canal"],
    });
    expect(parametersFromJsonSchema(JSON.parse(JSON.stringify(schema)))).toEqual(parameters);
    expect(parametersFromJsonSchema({})).toEqual([]);
    expect(parametersToJsonSchema([])).toEqual({ type: "object", properties: {} });
    expect(parametersFromJsonSchema({ type: "object", properties: { x: { type: "date" } } })).toBeNull();
    expect(parametersFromJsonSchema("nada")).toBeNull();
  });

  it("are validated with Zod when the model calls: types, required ones and the options of a list, in Spanish", () => {
    const schema = httpToolArgumentsSchema(parameters);
    expect(schema.safeParse({ numero: "A-42", canal: "web" }).success).toBe(true);
    expect(schema.safeParse({ numero: "A-42", canal: "web", cantidad: 3, urgente: true }).data).toEqual({ numero: "A-42", canal: "web", cantidad: 3, urgente: true });
    expect(issues(schema.safeParse({ canal: "web" })).numero).toEqual(["Falta este dato."]);
    expect(issues(schema.safeParse({ numero: 42, canal: "web" })).numero?.[0]).toMatch(/texto/);
    expect(issues(schema.safeParse({ numero: "1", canal: "web", cantidad: "tres" })).cantidad?.[0]).toMatch(/número/);
    expect(issues(schema.safeParse({ numero: "1", canal: "web", urgente: "sí" })).urgente?.[0]).toMatch(/true o false/);
    expect(issues(schema.safeParse({ numero: "1", canal: "email" })).canal?.[0]).toMatch(/web, tienda/);
    expect(issues(schema.safeParse({ numero: "x".repeat(2_001), canal: "web" })).numero?.[0]).toMatch(/2\.000/);
    // What the model sees: the same types, descriptions and required list.
    const json = z.toJSONSchema(schema, { io: "input" });
    expect(json).toMatchObject({
      type: "object",
      properties: { numero: { type: "string", description: "Número del pedido" }, canal: { enum: ["web", "tienda"] }, urgente: { type: "boolean" } },
      required: ["numero", "canal"],
    });
  });
});

describe("the request of one call [HER-11]", () => {
  const tool = (overrides: Partial<{ method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; url: string; parameters: HttpToolParameter[] }> = {}) => ({
    method: "GET" as const,
    url: "https://crm.example.com/clientes/{email}/pedidos",
    parameters: [param({ name: "email" }), param({ name: "estado", required: false }), param({ name: "limite", type: "number", required: false })],
    ...overrides,
  });

  it("URL-encodes every value put in the address, so it cannot change the path, the query or the server", () => {
    const plan = planHttpToolCall(tool(), { email: "ana/../../admin?x=1#y @ñ" });
    expect(plan).toEqual({
      ok: true,
      plan: { method: "GET", url: "https://crm.example.com/clientes/ana%2F..%2F..%2Fadmin%3Fx%3D1%23y%20%40%C3%B1/pedidos", body: null },
    });
  });

  it("refuses values that would climb the path («.», «..») or leave it empty", () => {
    for (const email of ["..", ".", ""]) {
      expect(planHttpToolCall(tool(), { email }), JSON.stringify(email)).toEqual({ ok: false, reason: "invalid_value", parameter: "email" });
    }
  });

  it("GET: the other parameters given go in the query; missing optional ones are left out", () => {
    expect(planHttpToolCall(tool(), { email: "ana@example.com", limite: 5 })).toEqual({
      ok: true,
      plan: { method: "GET", url: "https://crm.example.com/clientes/ana%40example.com/pedidos?limite=5", body: null },
    });
    const withQuery = planHttpToolCall(tool({ url: "https://crm.example.com/buscar?q={email}" }), { email: "a b&c", estado: "abierto" });
    expect(withQuery.ok && new URL(withQuery.plan.url).searchParams.get("q")).toBe("a b&c");
    expect(withQuery.ok && new URL(withQuery.plan.url).searchParams.get("estado")).toBe("abierto");
  });

  it("POST, PUT, PATCH and DELETE: the other parameters go in a JSON body, with their types", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      const plan = planHttpToolCall(tool({ method }), { email: "ana@example.com", estado: "abierto", limite: 5 });
      expect(plan).toEqual({
        ok: true,
        plan: { method, url: "https://crm.example.com/clientes/ana%40example.com/pedidos", body: JSON.stringify({ estado: "abierto", limite: 5 }) },
      });
    }
    const empty = planHttpToolCall(tool({ method: "POST", url: "https://n8n.example.com/webhook/abc" }), { email: "a@b.es" });
    expect(empty.ok && empty.plan.body).toBe(JSON.stringify({ email: "a@b.es" }));
  });
});
