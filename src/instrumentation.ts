// Runs once when a Next.js server starts, before it answers any request (node_modules/next/dist/docs:
// instrumentation.md). [SEG-03]: without a usable APP_ENCRYPTION_KEY the app does not start and says why.
// [CON-12] [ARR-15]: embeddings left pending without a key are queued when there is one now (a key in .env.local
// counts once the app restarts); in the background, so the start is never slower nor stopped by it.
// This file is also built for the Edge runtime: everything of the server is imported after the Node.js check.

/** `next build` also loads this file: nothing to resume while building. */
const BUILD_PHASE = "phase-production-build";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertEncryptionKeyConfigured, EncryptionKeyError } = await import("./server/crypto");
  try {
    assertEncryptionKeyConfigured();
  } catch (error) {
    // Only the explanation: never the value of the key.
    if (error instanceof EncryptionKeyError) console.error(`[arranque] La app no puede arrancar. ${error.message}`);
    throw error;
  }
  if (process.env.NEXT_PHASE === BUILD_PHASE) return;
  const [{ resumePendingEmbeddings }, { safeErrorMessage }] = await Promise.all([import("./server/knowledge/maintenance"), import("./server/redact")]);
  resumePendingEmbeddings().catch((error: unknown) => {
    console.warn(`[arranque] No se han podido revisar los embeddings pendientes: ${safeErrorMessage(error)}`);
  });
}
