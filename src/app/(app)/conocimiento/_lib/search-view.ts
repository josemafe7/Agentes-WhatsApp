// What «Probar búsqueda» receives from the server ([CON-21]): the search result without the ids of the index.
import type { KnowledgeSearchResult } from "@/server/knowledge/search";

export type KnowledgeSearchResultView = Pick<
  KnowledgeSearchResult["results"][number],
  "rank" | "documentId" | "title" | "section" | "page" | "content" | "score" | "vectorScore" | "textRank"
>;

export type KnowledgeSearchView = Pick<KnowledgeSearchResult, "status" | "mode" | "reranked"> & { results: KnowledgeSearchResultView[] };
