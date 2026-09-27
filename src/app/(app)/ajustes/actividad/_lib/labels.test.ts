// The activity log speaks Spanish ([AJU-10], [SEG-10]): every action the app writes has its label, so nobody reads a code.
// The actions are read from the source, as written in writeAudit() and in the helpers that pass it on.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
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
