// Token estimate without a tokenizer (docs/busqueda-hibrida.md §6), for the pipeline. The screens import it from
// src/lib/knowledge-limits.ts, the same code: an editor shows the number the server will count.
import "server-only";

export { charsForTokens, estimateTokens } from "@/lib/knowledge-limits";
