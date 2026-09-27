// Precomputed embeddings of the demo's knowledge ([ARR-12], [ARR-13], docs/busqueda-hibrida.md §7), stored in
// seed/fixtures/embeddings.json. `pnpm seed` looks up each demo chunk by its key (SHA-256 of model + dimensions + the
// exact text sent to the API, the same key the pipeline stores in kb_chunks.content_hash) and, when the file has
// it for the base's model and size, stores the vector, so search by meaning works without embedding anything
// again. `pnpm seed:embeddings` writes the file. A chunk whose text, model or size changed simply finds no key.
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { EMBEDDING_DIMENSIONS } from "@/db/schema/columns";
import { decodeEmbedding, embeddingKey } from "@/server/knowledge/embeddings";

export const DEMO_EMBEDDINGS_FILE = path.join(process.cwd(), "seed", "fixtures", "embeddings.json");

const SHA256_HEX = /^[0-9a-f]{64}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const demoEmbeddingsSchema = z
  .object({
    version: z.literal(1),
    model: z.string().trim().min(1),
    dimensions: z.number().int().positive(),
    encoding: z.literal("f32le-base64"),
    /** Null until `pnpm seed:embeddings` has run once. */
    generatedAt: z.string().nullable(),
    items: z.record(z.string().regex(SHA256_HEX), z.string().regex(BASE64)),
  })
  .strict();

export type DemoEmbeddings = z.infer<typeof demoEmbeddingsSchema>;

/** A file with no vectors yet (what the repository holds until the owner runs `pnpm seed:embeddings`). */
export function emptyDemoEmbeddings(model: string): DemoEmbeddings {
  return { version: 1, model, dimensions: EMBEDDING_DIMENSIONS, encoding: "f32le-base64", generatedAt: null, items: {} };
}

/** Reads the fixtures' JSON; a file that is not in this format is an error, never half used. */
export function parseDemoEmbeddings(json: string): DemoEmbeddings {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("seed/fixtures/embeddings.json no es un JSON válido: vuelve a generarlo con pnpm seed:embeddings.");
  }
  const parsed = demoEmbeddingsSchema.safeParse(data);
  if (!parsed.success) throw new Error("seed/fixtures/embeddings.json no tiene el formato esperado: vuelve a generarlo con pnpm seed:embeddings.");
  return parsed.data;
}

/** The fixtures file, or null when there is none. */
export function loadDemoEmbeddings(file: string = DEMO_EMBEDDINGS_FILE): DemoEmbeddings | null {
  if (!fs.existsSync(file)) return null;
  return parseDemoEmbeddings(fs.readFileSync(file, "utf8"));
}

/**
 * The key of a chunk's embedding text and its stored vector, if the fixtures have it for this model and size. A
 * stored vector of another length, or with values that are not numbers, is ignored.
 */
export function demoEmbeddingFor(fixtures: DemoEmbeddings | null, input: { model: string; dims: number; text: string }): { key: string; embedding: number[] | null } {
  const key = embeddingKey(input.model, input.dims, input.text);
  if (!fixtures || fixtures.model !== input.model || fixtures.dimensions !== input.dims || input.dims !== EMBEDDING_DIMENSIONS) return { key, embedding: null };
  const stored = fixtures.items[key];
  if (!stored) return { key, embedding: null };
  const embedding = decodeEmbedding(stored);
  return { key, embedding: embedding.length === input.dims && embedding.every(Number.isFinite) ? embedding : null };
}

/** The file's text: keys in order (a readable diff) and a final newline. */
export function serializeDemoEmbeddings(fixtures: DemoEmbeddings): string {
  const items = Object.fromEntries(Object.entries(fixtures.items).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return `${JSON.stringify({ ...fixtures, items }, null, 2)}\n`;
}

/** Writes the file in one go (a temporary file renamed over it): an interrupted run never leaves half a file. */
export function writeDemoEmbeddings(fixtures: DemoEmbeddings, file: string = DEMO_EMBEDDINGS_FILE): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, serializeDemoEmbeddings(fixtures));
  fs.renameSync(temporary, file);
}
