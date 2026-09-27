import { describe, expect, it } from "vitest";
import { CONTEXT_FILES_MAX_TOKENS, CONTEXT_FILES_WARN_TOKENS } from "@/server/knowledge/constants";
import {
  budgetLevel,
  budgetPercent,
  CONTEXT_UPLOAD_ACCEPT,
  CONTEXT_UPLOAD_MAX_BYTES,
  costPerMessage,
  knowledgeSearchHint,
  uploadProblem,
} from "./view";

const LIMITS = { maxTokens: CONTEXT_FILES_MAX_TOKENS, warnTokens: CONTEXT_FILES_WARN_TOKENS };

describe("tope de los archivos de contexto [CON-02]", () => {
  it("is fine below 20,000 tokens, warns from 20,000 and is full at 30,000", () => {
    expect(budgetLevel(0, LIMITS)).toBe("ok");
    expect(budgetLevel(19_999, LIMITS)).toBe("ok");
    expect(budgetLevel(20_000, LIMITS)).toBe("warning");
    expect(budgetLevel(29_999, LIMITS)).toBe("warning");
    expect(budgetLevel(30_000, LIMITS)).toBe("full");
    expect(budgetLevel(31_000, LIMITS)).toBe("full");
  });

  it("the bar shows the share of the cap, never more than 100 %", () => {
    expect(budgetPercent(0, 30_000)).toBe(0);
    expect(budgetPercent(15_000, 30_000)).toBe(50);
    expect(budgetPercent(45_000, 30_000)).toBe(100);
  });

  it("the cost per message is the tokens times the model's input price per million; unknown price, no amount", () => {
    expect(costPerMessage(10_000, 0.2)).toBeCloseTo(0.002, 10);
    expect(costPerMessage(25_000, 3)).toBeCloseTo(0.075, 10);
    expect(costPerMessage(10_000, null)).toBeNull();
    expect(costPerMessage(0, 0.2)).toBe(0);
  });
});

describe("archivo elegido para subir [CON-01] [CON-04]", () => {
  it("offers PDF, DOCX, TXT and MD only", () => {
    const accepted = CONTEXT_UPLOAD_ACCEPT.split(",");
    for (const extension of [".pdf", ".docx", ".txt", ".md"]) expect(accepted).toContain(extension);
    for (const extension of [".xlsx", ".csv", ".doc", ".png"]) expect(accepted).not.toContain(extension);
  });

  it("an empty file or one larger than the upload limit is refused before sending, with the reason", () => {
    expect(uploadProblem({ size: 0 })).toBe("El archivo está vacío.");
    expect(uploadProblem({ size: CONTEXT_UPLOAD_MAX_BYTES + 1 })).toMatch(/demasiado grande.*3,5 MB/);
    expect(uploadProblem({ size: CONTEXT_UPLOAD_MAX_BYTES })).toBeNull();
    expect(uploadProblem({ size: 2_048 })).toBeNull();
  });

  it("the upload limit stays under the 4 MB body limit of Server Actions (next.config.ts)", () => {
    expect(CONTEXT_UPLOAD_MAX_BYTES).toBeLessThan(4 * 1024 * 1024);
  });
});

describe("cuándo busca el agente [AGE-07] [HER-01]", () => {
  it("in «Automático» with bases but without buscar_conocimiento, it says the tool must be switched on", () => {
    expect(knowledgeSearchHint({ selectedCount: 1, knowledgeMode: "auto", systemTools: ["transferir_a_humano"] })).toBe("enable_tool");
  });

  it("no hint with the tool on, in «Buscar siempre» (it searches before every reply) or without bases", () => {
    expect(knowledgeSearchHint({ selectedCount: 2, knowledgeMode: "auto", systemTools: ["buscar_conocimiento", "transferir_a_humano"] })).toBeNull();
    expect(knowledgeSearchHint({ selectedCount: 2, knowledgeMode: "always", systemTools: ["transferir_a_humano"] })).toBeNull();
    expect(knowledgeSearchHint({ selectedCount: 0, knowledgeMode: "auto", systemTools: [] })).toBeNull();
  });
});
