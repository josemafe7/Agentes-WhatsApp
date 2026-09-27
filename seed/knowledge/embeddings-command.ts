// `pnpm seed:embeddings` ([ARR-13], docs/busqueda-hibrida.md §7): recomputes the embeddings of every demo chunk of
// every sector with the default model (1536 dimensions) and rewrites seed/fixtures/embeddings.json, keys in order and
// without the keys no chunk uses any more. It needs OPENROUTER_API_KEY in .env.local and costs a little AI; without
// the key it refuses and changes nothing. The key is never printed. No database is needed: the texts come from
// seed/knowledge exactly as `pnpm seed` builds them.
import { EMBEDDING_DIMENSIONS } from "@/db/schema/columns";
import { SECTORS } from "@/lib/enums";
import { createOpenRouterClient } from "@/lib/openrouter/client";
import { DEFAULT_MODELS } from "@/lib/openrouter/default-models";
import { isOpenRouterError } from "@/lib/openrouter/errors";
import { EMBEDDING_BATCH_SIZE } from "@/server/knowledge/constants";
import { encodeEmbedding } from "@/server/knowledge/embeddings";
import { buildDemoKnowledge, demoEmbeddingTexts } from "./index";
import { DEMO_EMBEDDINGS_FILE, writeDemoEmbeddings, type DemoEmbeddings } from "./fixtures";

export type CommandOutput = { log: (line: string) => void; error: (line: string) => void };

export type SeedEmbeddingsOptions = {
  env?: Readonly<Record<string, string | undefined>>;
  out?: CommandOutput;
  /** Tests pass a fake OpenRouter; the command never calls anything else. */
  fetchImpl?: typeof fetch;
  file?: string;
  now?: Date;
};

export const MISSING_KEY_MESSAGE =
  "Falta la clave de OpenRouter: pon OPENROUTER_API_KEY en .env.local (se crea en https://openrouter.ai/settings/keys) y vuelve a lanzar pnpm seed:embeddings. No se ha cambiado nada.";

class WrongDimensionsError extends Error {}

/** Returns the process exit code: 0 when the file was written, 1 when nothing changed. */
export async function runSeedEmbeddingsCommand(options: SeedEmbeddingsOptions = {}): Promise<number> {
  const env = options.env ?? process.env;
  const out = options.out ?? { log: (line) => console.log(line), error: (line) => console.error(line) };
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    out.error(MISSING_KEY_MESSAGE);
    return 1;
  }

  const model = DEFAULT_MODELS.embeddings;
  const dims = EMBEDDING_DIMENSIONS;
  const texts = new Map<string, string>();
  for (const sector of SECTORS) for (const { key, text } of demoEmbeddingTexts(await buildDemoKnowledge(sector), model, dims)) texts.set(key, text);
  const entries = [...texts];
  out.log(`Calculando ${entries.length} embeddings de la demo (${SECTORS.length} sectores) con ${model}…`);

  const client = createOpenRouterClient({ apiKey, fetchImpl: options.fetchImpl });
  const items: Record<string, string> = {};
  let cost = 0;
  let costKnown = true;
  try {
    for (let start = 0; start < entries.length; start += EMBEDDING_BATCH_SIZE) {
      const batch = entries.slice(start, start + EMBEDDING_BATCH_SIZE);
      // data_collection «deny» goes on every embeddings call (src/lib/openrouter/client.ts).
      const result = await client.embeddings({ model, input: batch.map(([, text]) => text), dimensions: dims, zdr: false });
      result.embeddings.forEach((vector, index) => {
        if (vector.length !== dims || !vector.every(Number.isFinite)) throw new WrongDimensionsError();
        items[batch[index][0]] = encodeEmbedding(vector);
      });
      if (result.usage.cost === null) costKnown = false;
      else cost += result.usage.cost;
    }
  } catch (error) {
    // Generic Spanish reasons only: never the key or the raw response.
    const reason =
      error instanceof WrongDimensionsError
        ? `el modelo ${model} no ha dado vectores de ${dims} dimensiones`
        : isOpenRouterError(error)
          ? error.userMessage
          : "error inesperado al llamar a OpenRouter";
    out.error(`No se han calculado los embeddings de la demo: ${reason.trim().replace(/\.$/, "")}. No se ha cambiado nada.`);
    return 1;
  }

  const fixtures: DemoEmbeddings = {
    version: 1,
    model,
    dimensions: dims,
    encoding: "f32le-base64",
    generatedAt: (options.now ?? new Date()).toISOString(),
    items,
  };
  writeDemoEmbeddings(fixtures, options.file ?? DEMO_EMBEDDINGS_FILE);
  out.log(
    `Listo: ${entries.length} embeddings guardados en seed/fixtures/embeddings.json${costKnown ? ` (coste: ${cost.toFixed(6)} USD)` : ""}. Súbelo al repositorio: la demo los usará al cargarse (pnpm seed o pnpm db:reset).`,
  );
  return 0;
}
