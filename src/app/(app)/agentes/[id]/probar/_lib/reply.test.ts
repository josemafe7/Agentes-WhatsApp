import { describe, expect, it } from "vitest";
import type { RunAgentResult } from "@/server/ai/run-agent";
import { toTestReply } from "./reply";

function runResult(retrievals: RunAgentResult["retrievals"]): RunAgentResult {
  return {
    runId: crypto.randomUUID(),
    text: "Un corte cuesta 18 €.",
    toolCalls: [],
    usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110, cachedTokens: 0, reasoningTokens: 0 },
    costUsd: 0.0001,
    latencyMs: 500,
    modelRequested: "openai/gpt-5.6-luna",
    modelUsed: "openai/gpt-5.6-luna",
    provider: "OpenAI",
    steps: 2,
    handedOff: false,
    retrievals,
  };
}

const SALON = crypto.randomUUID();

describe("«Probar agente»: each fragment with its score and source [PRU-02]", () => {
  it("gives rank, score, title, section, page and the name of its base", () => {
    const reply = toTestReply(
      runResult([
        { chunkId: crypto.randomUUID(), documentId: crypto.randomUUID(), kbId: SALON, rank: 1, score: 0.033, title: "Tarifas 2026", section: "Cortes", page: 3 },
        { chunkId: crypto.randomUUID(), documentId: crypto.randomUUID(), kbId: SALON, rank: 2, score: 0.016, title: "Preguntas frecuentes", section: null, page: null },
      ]),
      "whatsapp",
      new Map([[SALON, "Peluquería"]]),
    );
    expect(reply.retrievals).toEqual([
      { rank: 1, score: 0.033, title: "Tarifas 2026", section: "Cortes", page: 3, knowledgeBase: "Peluquería" },
      { rank: 2, score: 0.016, title: "Preguntas frecuentes", section: null, page: null, knowledgeBase: "Peluquería" },
    ]);
  });

  it("a base it cannot name (deleted meanwhile, or no names given) stays without a name", () => {
    const retrieval = { chunkId: null, documentId: null, kbId: crypto.randomUUID(), rank: 1, score: null, title: "Horario", section: null, page: null };
    expect(toTestReply(runResult([retrieval]), "webchat", new Map([[SALON, "Peluquería"]])).retrievals).toEqual([
      { rank: 1, score: null, title: "Horario", section: null, page: null, knowledgeBase: null },
    ]);
    expect(toTestReply(runResult([{ ...retrieval, kbId: SALON }]), "webchat").retrievals[0]?.knowledgeBase).toBeNull();
  });

  it("never sends internal ids to the browser", () => {
    const reply = toTestReply(
      runResult([{ chunkId: crypto.randomUUID(), documentId: crypto.randomUUID(), kbId: SALON, rank: 1, score: 0.5, title: "Tarifas", section: null, page: null }]),
      "email",
      new Map([[SALON, "Peluquería"]]),
    );
    expect(JSON.stringify(reply)).not.toMatch(/runId|chunkId|documentId|kbId/);
    expect(JSON.stringify(reply)).not.toContain(SALON);
  });
});
