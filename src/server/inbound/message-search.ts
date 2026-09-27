// Search without accents in the text of the messages of the Bandeja ([BAN-02]): «cancelacion» finds «cancelación».
// Each message keeps its text in lower case and without accents in `messages.search_text`, written with the text
// wherever a message is stored or its text changes (inbound, outbound, drafts, mailbox replies, the demo), and the
// inbox compares the search, normalized the same way, with it. It is a copy of what was said: retention clears it with
// the text ([CUM-05]) and erasing a contact deletes it with the messages ([CTO-07]). Portable: a plain LIKE on a column,
// no functions of SQLite (docs/conventions.md). The messages written before the column existed are filled once by
// backfillMessageSearchText(), which the server starts in the background (src/instrumentation.ts).
import "server-only";
import { and, asc, eq, gt, isNotNull, isNull, like, or, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { normalizeForMatch } from "@/server/engine/rules";
import { getKv, setKv } from "@/server/kv";

/** The text of a message in lower case and without accents, or null when it has none. */
export function messageSearchText(text: string | null | undefined): string | null {
  if (!text) return null;
  return normalizeForMatch(text) || null;
}

/**
 * A message matches a search by its search text, and also by its plain text as before: a message the one-time
 * backfill has not reached yet is still found, just not without accents.
 */
export function messageSearchCondition(search: string): SQL {
  const normalized = normalizeForMatch(search);
  return or(...(normalized ? [like(messages.searchText, `%${normalized}%`)] : []), like(messages.text, `%${search}%`)) as SQL;
}

// ─── One-time backfill ──────────────────────────────────────────────────────────────────────────────────

/** Mark in app_kv: the messages of this database already have their search text. */
export const MESSAGE_SEARCH_BACKFILL_KEY = "search.messages_backfilled";
const BACKFILL_BATCH = 500;

/**
 * Fills the search text of the messages written before the column existed. Once per database (the mark in app_kv),
 * in batches of short transactions; never overwrites a value a write has just stored, nor touches `updated_at`, and a
 * message whose text was cleared in the meantime (retention) stays without one.
 */
export async function backfillMessageSearchText(): Promise<{ updated: number; skipped: boolean }> {
  if (await getKv(MESSAGE_SEARCH_BACKFILL_KEY)) return { updated: 0, skipped: true };
  let updated = 0;
  let after = "";
  for (;;) {
    const rows = await db
      .select({ id: messages.id, text: messages.text, updatedAt: messages.updatedAt })
      .from(messages)
      .where(and(isNull(messages.searchText), isNotNull(messages.text), gt(messages.id, after)))
      .orderBy(asc(messages.id))
      .limit(BACKFILL_BATCH);
    if (rows.length === 0) break;
    await db.transaction(async (tx) => {
      for (const row of rows) {
        const searchText = messageSearchText(row.text);
        if (!searchText) continue;
        await tx
          .update(messages)
          .set({ searchText, updatedAt: row.updatedAt })
          .where(and(eq(messages.id, row.id), isNull(messages.searchText), eq(messages.text, row.text ?? "")));
        updated++;
      }
    });
    after = rows[rows.length - 1].id;
  }
  await setKv(MESSAGE_SEARCH_BACKFILL_KEY, { at: new Date().toISOString(), updated });
  return { updated, skipped: false };
}
