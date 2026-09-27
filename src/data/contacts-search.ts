// Search without accents in Contactos and the Bandeja ([CTO-01], [BAN-02]): «jose» finds «José» and «munoz» finds
// «Muñoz». Each contact keeps its name, phone and email in lower case and without accents in `contacts.search_text`,
// written with every change of those fields, and the lists compare the search, normalized the same way, with it.
// Portable: a plain LIKE on a column, no functions of SQLite (docs/conventions.md). The contacts written before the
// column existed are filled once by backfillContactSearchText(), which the server starts in the background
// (src/instrumentation.ts). System helpers: the callers check permissions.
import "server-only";
import { and, asc, eq, gt, isNull, like, or, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { contacts } from "@/db/schema";
import { normalizeForMatch } from "@/server/engine/rules";
import { getKv, setKv } from "@/server/kv";

type SearchableContact = { name?: string | null; phone?: string | null; email?: string | null };

/** Name, phone (also as bare digits, so «600111222» finds «+34 600 111 222») and email, lower case and without accents. */
export function contactSearchText(contact: SearchableContact): string | null {
  const digits = contact.phone?.replace(/\D/g, "") ?? "";
  const parts = [contact.name, contact.phone, digits !== contact.phone ? digits : null, contact.email];
  return normalizeForMatch(parts.filter((part): part is string => Boolean(part)).join(" ")) || null;
}

/**
 * A contact matches a search by its search text, and also by its plain name, phone or email as before: a contact the
 * one-time backfill has not reached yet is still found, just not without accents.
 */
export function contactSearchCondition(search: string): SQL {
  const plain = `%${search}%`;
  const normalized = normalizeForMatch(search);
  return or(
    ...(normalized ? [like(contacts.searchText, `%${normalized}%`)] : []),
    like(contacts.name, plain),
    like(contacts.phone, plain),
    like(contacts.email, plain),
  ) as SQL;
}

// ─── One-time backfill ──────────────────────────────────────────────────────────────────────────────────

/** Mark in app_kv: the contacts of this database already have their search text. */
export const CONTACT_SEARCH_BACKFILL_KEY = "search.contacts_backfilled";
const BACKFILL_BATCH = 500;

/**
 * Fills the search text of the contacts written before the column existed. Once per database (the mark in app_kv), in
 * batches of short transactions; never overwrites a value a write has just stored, nor touches `updated_at`.
 */
export async function backfillContactSearchText(): Promise<{ updated: number; skipped: boolean }> {
  if (await getKv(CONTACT_SEARCH_BACKFILL_KEY)) return { updated: 0, skipped: true };
  let updated = 0;
  let after = "";
  for (;;) {
    const rows = await db
      .select({ id: contacts.id, name: contacts.name, phone: contacts.phone, email: contacts.email, updatedAt: contacts.updatedAt })
      .from(contacts)
      .where(and(isNull(contacts.searchText), gt(contacts.id, after)))
      .orderBy(asc(contacts.id))
      .limit(BACKFILL_BATCH);
    if (rows.length === 0) break;
    await db.transaction(async (tx) => {
      for (const row of rows) {
        const searchText = contactSearchText(row);
        if (!searchText) continue;
        await tx
          .update(contacts)
          .set({ searchText, updatedAt: row.updatedAt })
          .where(and(eq(contacts.id, row.id), isNull(contacts.searchText)));
        updated++;
      }
    });
    after = rows[rows.length - 1].id;
  }
  await setKv(CONTACT_SEARCH_BACKFILL_KEY, { at: new Date().toISOString(), updated });
  return { updated, skipped: false };
}
