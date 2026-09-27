// What every change of the knowledge that queues background work shares: the work starts right after answering
// (as after a webhook, [MOT-15]) instead of waiting for the next cron tick, and adding content is limited per
// person because each document costs AI (summary and embeddings, [SEG-07]).
import "server-only";
import { getRateLimiter } from "@/server/adapters/rate-limiter";
import { RateLimitError } from "@/server/errors";
import { kickTick } from "@/server/inbound/ingest";

/**
 * Seconds a page of Conocimiento (and its Server Actions) or the upload route may run: the processing that
 * startKnowledgeWork() launches uses this time. Pages export `maxDuration = 60` with the same value (Next.js needs
 * the number written in the file).
 */
export const KNOWLEDGE_MAX_DURATION_SEC = 60;

/** Runs the queue with the time left after the answer; whatever does not fit, the cron picks up. */
export function startKnowledgeWork(): void {
  kickTick({ maxDurationSec: KNOWLEDGE_MAX_DURATION_SEC });
}

/** Files, web pages and FAQs added per person. Generous for a business loading its documents. */
export const KNOWLEDGE_ADD_LIMIT = { limit: 60, windowMs: 10 * 60_000 } as const;

export async function enforceKnowledgeAddLimit(userId: string): Promise<void> {
  const hit = await getRateLimiter().hit(`knowledge:add:${userId}`, KNOWLEDGE_ADD_LIMIT.limit, KNOWLEDGE_ADD_LIMIT.windowMs);
  if (!hit.allowed) throw new RateLimitError("Has añadido mucho contenido seguido. Espera unos minutos y sigue.");
}

/**
 * «Reprocesar», «Reintentar», «Refrescar», editing a FAQ and «Reindexar» per person: each one runs the processing
 * again (the page or file read again, a summary by the chat model, embeddings), so it costs AI too ([SEG-07]).
 */
export const KNOWLEDGE_REPROCESS_LIMIT = { limit: 30, windowMs: 10 * 60_000 } as const;

export async function enforceKnowledgeReprocessLimit(userId: string): Promise<void> {
  const hit = await getRateLimiter().hit(`knowledge:reprocess:${userId}`, KNOWLEDGE_REPROCESS_LIMIT.limit, KNOWLEDGE_REPROCESS_LIMIT.windowMs);
  if (!hit.allowed) throw new RateLimitError("Has vuelto a procesar mucho contenido seguido. Espera unos minutos y sigue.");
}
