// Start-up upkeep, once per server process: src/instrumentation.ts starts it in the background, and on Vercel (where
// work no request waits for is frozen halfway) the first cron tick of each instance runs it instead.
// [CON-12] [ARR-15]: embeddings left pending without a key are queued when there is one now (a key in .env.local
// counts once the app restarts). [CTO-01] [BAN-02]: contacts and messages written before `search_text` existed get
// it once, so searches find them without accents. [CUM-05]: the daily clean-up job exists (one for the installation;
// asking again changes nothing). Each part fails on its own, with a warning that never carries a key or an address.
import "server-only";
import { backfillContactSearchText } from "@/data/contacts-search";
import { ensureRetentionJob } from "@/server/compliance/retention";
import { backfillMessageSearchText } from "@/server/inbound/message-search";
import { resumePendingEmbeddings } from "@/server/knowledge/maintenance";
import { safeErrorMessage } from "@/server/redact";

// Shared by every bundle of the process (instrumentation and the routes are built apart).
const state = globalThis as unknown as { __dominiaStartupMaintenance?: Promise<void> };

/** Runs the upkeep the first time it is called in this process; later calls wait for that same run. Never fails. */
export function runStartupMaintenance(): Promise<void> {
  state.__dominiaStartupMaintenance ??= Promise.all([
    attempt(() => resumePendingEmbeddings(), "No se han podido revisar los embeddings pendientes"),
    attempt(() => backfillContactSearchText(), "No se ha podido preparar la búsqueda de contactos sin tildes"),
    attempt(() => backfillMessageSearchText(), "No se ha podido preparar la búsqueda de mensajes sin tildes"),
    attempt(() => ensureRetentionJob(), "No se ha podido programar la limpieza diaria"),
  ]).then(() => undefined);
  return state.__dominiaStartupMaintenance;
}

async function attempt(task: () => Promise<unknown>, failure: string): Promise<void> {
  try {
    await task();
  } catch (error) {
    console.warn(`[arranque] ${failure}: ${safeErrorMessage(error)}`);
  }
}
