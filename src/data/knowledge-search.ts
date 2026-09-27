// «Probar búsqueda» ([CON-21]): the same hybrid search the agents use, without the chat model, showing the fragments
// with their score and source. The query embedding costs money: limited per person ([SEG-07]).
import "server-only";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { knowledgeBases } from "@/db/schema";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { getRateLimiter } from "@/server/adapters/rate-limiter";
import type { OpenRouterDeps } from "@/server/ai/openrouter";
import { NotFoundError, parseInput, RateLimitError } from "@/server/errors";
import { MAX_QUERY_CHARS } from "@/server/knowledge/constants";
import { searchKnowledge, type KnowledgeSearchResult } from "@/server/knowledge/search";
import { assertCan } from "./guard";

/** Test searches per person and minute. */
export const TEST_SEARCH_LIMIT = { limit: 20, windowMs: 60_000 } as const;

export const testKnowledgeSearchSchema = z
  .object({
    kbIds: z.array(idSchema).min(1, "Elige al menos una base.").max(50),
    query: z.string().trim().min(2, "Escribe qué quieres buscar.").max(MAX_QUERY_CHARS, "La búsqueda es demasiado larga."),
  })
  .strict();

export async function testKnowledgeSearch(actor: Actor, input: unknown, deps: OpenRouterDeps = {}): Promise<KnowledgeSearchResult> {
  assertCan(actor, PERMISSIONS.knowledge.testSearch);
  const data = parseInput(testKnowledgeSearchSchema, input);
  const found = await db.select({ id: knowledgeBases.id }).from(knowledgeBases).where(inArray(knowledgeBases.id, data.kbIds));
  if (found.length === 0) throw new NotFoundError("No se ha encontrado la base de conocimiento.");
  const hit = await getRateLimiter().hit(`ai:knowledge_search:${actor.userId}`, TEST_SEARCH_LIMIT.limit, TEST_SEARCH_LIMIT.windowMs);
  if (!hit.allowed) throw new RateLimitError("Has hecho muchas búsquedas seguidas. Espera un minuto y vuelve a intentarlo.");
  return searchKnowledge({ kbIds: found.map((row) => row.id), query: data.query, run: { mode: "test" } }, deps);
}
