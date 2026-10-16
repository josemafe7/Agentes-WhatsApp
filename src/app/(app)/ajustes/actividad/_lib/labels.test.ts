// The activity log speaks Spanish ([AJU-10], [SEG-10]): every action the app writes has its label, so nobody reads a code.
// The actions are read from the source, as written in writeAudit() and in the helpers that pass it on.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detailItems } from "./details";
import { actionLabel, detailLines, targetLabel } from "./labels";

const SRC = path.join(process.cwd(), "src");
const CODE = "([a-z_]+\\.[a-z_]+)";
const PATTERNS = [
  // writeAudit({ action: "x.y" }) and { action: condition ? "x.y" : "x.z" }
  new RegExp(`action:\\s*"${CODE}"`, "g"),
  new RegExp(`action:\\s*[^"\\n,]*\\?\\s*"${CODE}"\\s*:\\s*"${CODE}"`, "g"),
  // Helpers that write the entry with the action they get.
  new RegExp(`(?:completeStep|saveNewVersion|revalidateWith)\\([^;]*?"${CODE}"(?:\\s*:\\s*"${CODE}")?`, "g"),
];

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function auditActions(): string[] {
  const found = new Set<string>();
  for (const file of sourceFiles(SRC)) {
    const text = fs.readFileSync(file, "utf8");
    if (!text.includes("action")) continue;
    for (const pattern of PATTERNS) {
      for (const match of text.matchAll(pattern)) for (const code of match.slice(1)) if (code) found.add(code);
    }
  }
  return [...found].sort();
}

describe("activity log labels [AJU-10]", () => {
  it("every action the app writes has a Spanish label", () => {
    const actions = auditActions();
    // The scan finds the actions of every area (a broken pattern would find nothing and pass).
    for (const expected of ["auth.login", "contact.erased", "ai.http_tool_called", "setup.step_skipped", "agenda.service_deactivated", "channel.token_changed"]) {
      expect(actions).toContain(expected);
    }
    expect(actions.filter((action) => actionLabel(action) === action)).toEqual([]);
  });

  it("the generic tool entry and the HTTP call of the same tool read differently [HER-03]", () => {
    expect(actionLabel("ai.tool_called")).not.toBe(actionLabel("ai.http_tool_called"));
  });

  it("an unknown action or target shows its code; details read in Spanish", () => {
    expect(actionLabel("futuro.algo")).toBe("futuro.algo");
    expect(targetLabel("custom_tool")).toBe("Herramienta HTTP");
    expect(targetLabel(null)).toBeNull();
    expect(detailLines({ tool: "consultar_pedido", method: "GET", host: "crm.example.com", status: 200, ok: true })).toEqual([
      "herramienta: consultar_pedido",
      "método: GET",
      "servidor: crm.example.com",
      "respuesta: 200",
      "correcto: sí",
    ]);
  });
});

const KB_ID = "7cce25ef-0b1d-4e6a-9c1f-3a5b7d9e1f20";

describe("activity log details [AJU-10]", () => {
  it("names each detail in Spanish and words its closed values", () => {
    expect(detailItems({ teamAccess: "everyone", people: 0 })).toEqual([
      { label: "acceso", value: "Todo el equipo" },
      { label: "personas elegidas", value: "0" },
    ]);
    expect(detailLines({ teamAccess: "selected", people: 2 })).toEqual(["acceso: Personas concretas", "personas elegidas: 2"]);
    expect(detailLines({ added: 1, removed: 0 })).toEqual(["añadidas: 1", "quitadas: 0"]);
    for (const [sourceType, name] of Object.entries({ file: "Archivo", url: "Página web", faq: "Pregunta frecuente", text: "Texto" })) {
      expect(detailLines({ sourceType })).toEqual([`contenido: ${name}`]);
    }
    expect(detailLines({ type: "email_gmail" })).toEqual(["tipo: Gmail"]);
    expect(detailLines({ type: "whatsapp", via: "qr", again: false })).toEqual(["tipo: WhatsApp", "vía: Código QR", "otra vez: no"]);
    expect(detailLines({ ok: true, via: "outbox" })).toEqual(["correcto: sí", "vía: bandeja local"]);
    expect(detailLines({ trigger: "rule", rule: "keyword", urgency: "high", assigned: true })).toEqual([
      "origen: Regla del agente",
      "motivo: palabra clave",
      "urgencia: Alta",
      "asignada: sí",
    ]);
    expect(detailLines({ reason: "invalid_credentials" })).toEqual(["motivo: email o contraseña incorrectos"]);
    expect(detailLines({ tool: "consultar_pedido", ok: false, mode: "live", error: "timeout" })).toEqual([
      "herramienta: consultar_pedido",
      "correcto: no",
      "modo: real",
      "error: tiempo de espera agotado",
    ]);
    expect(detailLines({ audience: "team" })).toEqual(["para: el equipo"]);
  });

  it("an identifier shows only its beginning and keeps the whole of it for the tooltip", () => {
    expect(detailItems({ kbId: KB_ID, sourceType: "faq" })).toEqual([
      { label: "base de conocimiento", value: "7cce25ef…", full: KB_ID },
      { label: "contenido", value: "Pregunta frecuente" },
    ]);
    // In plain text there is no tooltip: the whole identifier.
    expect(detailLines({ agentId: KB_ID })).toEqual([`agente: ${KB_ID}`]);
    // Only a whole identifier is shortened, never a text that happens to carry one.
    expect(detailItems({ name: `Copia de ${KB_ID}` })).toEqual([{ label: "nombre", value: `Copia de ${KB_ID}` }]);
  });

  it("a detail reads as its action means it", () => {
    // «status» is the answer of an HTTP tool or the state of a booking or a conversation.
    expect(detailLines({ status: 200 }, "ai.http_tool_called")).toEqual(["respuesta: 200"]);
    expect(detailLines({ status: "confirmed" }, "booking.status_changed")).toEqual(["estado: Confirmada"]);
    expect(detailLines({ status: "pending_human" }, "conversation.status_changed")).toEqual(["estado: Pendiente de humano"]);
    // «from» is the role before a change or the agent a copy was made from.
    expect(detailLines({ from: "agent", to: "admin" }, "user.role_changed")).toEqual(["antes: Agente", "después: Administrador"]);
    expect(detailLines({ role: "viewer" }, "user.invited")).toEqual(["rol: Solo lectura"]);
    expect(detailItems({ from: KB_ID }, "agent.duplicated")).toEqual([{ label: "copia de", value: "7cce25ef…", full: KB_ID }]);
    // A word is only worded where it is a closed value: a base called «admin» keeps its name.
    expect(detailLines({ name: "admin" }, "knowledge.base_created")).toEqual(["nombre: admin"]);
    expect(detailLines({ mode: "pause" }, "conversation.ai_changed")).toEqual(["IA: en pausa"]);
    expect(detailLines({ count: 25, selected: false, filtered: true }, "contacts.exported")).toEqual([
      "contactos: 25",
      "solo los seleccionados: no",
      "con filtros: sí",
    ]);
    expect(detailLines({ contentType: "audio", file: "sample" }, "simulator.message_sent")).toEqual(["tipo de mensaje: Nota de voz", "archivo: de ejemplo"]);
    expect(detailLines({ contentType: "image/png", size: 20_480 }, "settings.logo_updated")).toEqual(["formato: image/png", "tamaño: 20 kB"]);
  });

  it("lists, days, markets, categories and sectors are worded too", () => {
    expect(detailLines({ events: ["handoff", "new_conversation"] })).toEqual(["avisos: Traspaso a una persona, Conversación nueva"]);
    expect(detailLines({ startDate: "2026-12-24", endDate: "2026-12-26" })).toEqual(["desde: 24 dic 2026", "hasta: 26 dic 2026"]);
    expect(detailLines({ country: "ES", category: "utility" })).toEqual(["mercado: España", "categoría: Utilidad"]);
    expect(detailLines({ template: "clinica-dental", audience: "customers" }, "agent.created")).toEqual(["plantilla: Clínica dental", "para: los clientes"]);
    expect(detailLines({ fields: ["name", "timezone"] })).toEqual(["campos: name, timezone"]);
  });

  it("what has no label shows as it was written; empty values and nested objects are left out", () => {
    expect(detailLines({ algoNuevo: "valor-nuevo", sourceType: "video", status: "archived", startDate: "pronto" })).toEqual([
      "algoNuevo: valor-nuevo",
      "contenido: video",
      "respuesta: archived",
      "desde: pronto",
    ]);
    expect(detailItems({ rule: null, via: undefined, fields: [], nested: { a: 1 }, name: "" })).toEqual([]);
    // Names that every object has are details like any other.
    expect(detailLines({ constructor: "x", toString: "y" })).toEqual(["constructor: x", "toString: y"]);
    expect(detailLines({ mode: "constructor" }, "toString")).toEqual(["modo: constructor"]);
  });

  it("the daily clean-up keeps its counters, each with its name [CUM-06]", () => {
    const counts = {
      webhookEvents: 3,
      audioFiles: 0,
      attachmentFiles: 0,
      conversationsDeleted: 2,
      conversationsAnonymized: 0,
      messagesDeleted: 14,
      messagesAnonymized: 0,
      notesDeleted: 1,
      notificationsDeleted: 0,
    };
    expect(detailLines(counts, "retention.cleanup")).toEqual([
      "avisos en bruto borrados: 3",
      "notas de voz borradas: 0",
      "adjuntos borrados: 0",
      "conversaciones borradas: 2",
      "conversaciones anonimizadas: 0",
      "mensajes borrados: 14",
      "mensajes anonimizados: 0",
      "notas internas borradas: 1",
      "avisos del equipo borrados: 0",
    ]);
  });
});
