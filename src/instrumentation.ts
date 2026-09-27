// Runs once when a Next.js server starts, before it answers any request (node_modules/next/dist/docs:
// instrumentation.md). The start-up checks of src/server/startup-checks.ts ([SEG-03], [SEG-11]), the same as
// `pnpm worker`: without a usable APP_ENCRYPTION_KEY, or with an unsafe configuration of a compiled app, it does not
// start and says why.
// [CON-12] [ARR-15]: embeddings left pending without a key are queued when there is one now (a key in .env.local
// counts once the app restarts); in the background, so the start is never slower nor stopped by it.
// [CUM-05]: the daily clean-up job exists (one for the installation; asking again changes nothing), also in background.
// This file is also built for the Edge runtime: everything of the server is imported after the Node.js check.

/** `next build` also loads this file: nothing to resume while building, and the address is checked when it starts. */
const BUILD_PHASE = "phase-production-build";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { checkStartupConfig, isStartupConfigError } = await import("./server/startup-checks");
  const building = process.env.NEXT_PHASE === BUILD_PHASE;
  let warnings: string[];
  try {
    warnings = checkStartupConfig({ building });
  } catch (error) {
    // Only the explanation: never the value of a key or an address.
    if (isStartupConfigError(error)) console.error(`[arranque] La app no puede arrancar. ${error.message}`);
    throw error;
  }
  for (const warning of warnings) console.warn(`[arranque] ${warning}`);
  if (building) return;
  const [{ resumePendingEmbeddings }, { safeErrorMessage }] = await Promise.all([import("./server/knowledge/maintenance"), import("./server/redact")]);
  resumePendingEmbeddings().catch((error: unknown) => {
    console.warn(`[arranque] No se han podido revisar los embeddings pendientes: ${safeErrorMessage(error)}`);
  });
  // [CTO-01] [BAN-02]: contacts and messages written before `search_text` existed get it once, so searches find them
  // without accents.
  const [{ backfillContactSearchText }, { backfillMessageSearchText }] = await Promise.all([
    import("./data/contacts-search"),
    import("./server/inbound/message-search"),
  ]);
  backfillContactSearchText().catch((error: unknown) => {
    console.warn(`[arranque] No se ha podido preparar la búsqueda de contactos sin tildes: ${safeErrorMessage(error)}`);
  });
  backfillMessageSearchText().catch((error: unknown) => {
    console.warn(`[arranque] No se ha podido preparar la búsqueda de mensajes sin tildes: ${safeErrorMessage(error)}`);
  });
  const { ensureRetentionJob } = await import("./server/compliance/retention");
  ensureRetentionJob().catch((error: unknown) => {
    console.warn(`[arranque] No se ha podido programar la limpieza diaria: ${safeErrorMessage(error)}`);
  });
}
