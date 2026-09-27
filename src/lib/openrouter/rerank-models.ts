// Rerank models of «Reordenar resultados» ([AJU-04], [CON-16]), as checked on 2026-09-26 (docs/integracion-openrouter.md
// §7 and §9). The API's model list does not include them, so the list lives here. With «Sin retención de datos» (ZDR)
// only the models whose every provider keeps no data are offered and used; none of Cohere's is one of them today.
import { DEFAULT_MODELS } from "./default-models";

export const RERANK_MODELS = [
  DEFAULT_MODELS.rerank,
  "cohere/rerank-4-fast",
  "cohere/rerank-4-pro",
  "voyageai/rerank-2.5-lite",
  "qwen/qwen3-reranker-8b",
] as const;

export type RerankModel = (typeof RERANK_MODELS)[number];

/** Rerank models with a zero-retention endpoint for every provider (§9): today only Fireworks' Qwen. */
export const ZDR_RERANK_MODELS: readonly RerankModel[] = ["qwen/qwen3-reranker-8b"];

export function isRerankModel(modelId: string): modelId is RerankModel {
  return (RERANK_MODELS as readonly string[]).includes(modelId);
}

export function isZdrRerankModel(modelId: string): boolean {
  return (ZDR_RERANK_MODELS as readonly string[]).includes(modelId);
}

/** Whether the search may reorder with `modelId`: with ZDR on, only with a model that keeps no data. */
export function canRerankWith(modelId: string, zdr: boolean): boolean {
  return !zdr || isZdrRerankModel(modelId);
}

/** The warning next to the field when the chosen model will not be used ([AJU-04]), or null. */
export function rerankZdrWarning(modelId: string, zdr: boolean): string | null {
  if (canRerankWith(modelId, zdr)) return null;
  return `Con «Sin retención de datos» activado no se usa este modelo, porque sus proveedores pueden guardar datos: la búsqueda no se reordena. Elige ${ZDR_RERANK_MODELS.join(" o ")}.`;
}

/** The models offered: all of them, or with ZDR only those without retention; the current one is always kept. */
export function rerankModelOptions(input: { zdr: boolean; current: string }): string[] {
  const offered: string[] = input.zdr ? [...ZDR_RERANK_MODELS] : [...RERANK_MODELS];
  return offered.includes(input.current) ? offered : [...offered, input.current];
}
