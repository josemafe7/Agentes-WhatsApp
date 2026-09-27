import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import type postgres from "postgres";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPglite,
  databaseUrlFromEnv,
  db,
  EMBEDDED_DATABASE_DIR,
  type Executor,
  isLegacyFileDatabaseUrl,
  isServerDatabase,
  isUniqueViolation,
  resolveDatabaseTarget,
  rowsOf,
  oneQueryAtATime,
  serverConnectionOptions,
  WRITE_LOCK_KEY,
} from "@/db";
import { migrateDatabase } from "@/db/migrate";
import { appKv, channelMembers, contacts, customTools, kbChunks, kbDocuments, knowledgeBases, user } from "@/db/schema";
import { schemaTables } from "@/server/demo/clear-data";
import { removeWithRetry } from "@/test/remove-with-retry";

const one = async <T>(executor: Executor, query: ReturnType<typeof sql>): Promise<T> => rowsOf<T>(await executor.execute(query))[0];

/** Granted advisory locks on WRITE_LOCK_KEY (a bigint key shows as classid 0 + objid). */
const writeLocks = async (executor: Executor) =>
  (
    await one<{ n: number }>(
      executor,
      sql`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND objid = ${WRITE_LOCK_KEY} AND granted`,
    )
  ).n;
const lockTimeout = async (executor: Executor) => (await one<{ v: string }>(executor, sql`SELECT current_setting('lock_timeout') AS v`)).v;

async function addChunk(values: { title?: string; content: string; embedding?: number[] }) {
  const [kb] = await db.insert(knowledgeBases).values({ name: "Base" }).returning();
  const [doc] = await db.insert(kbDocuments).values({ kbId: kb.id, sourceType: "text", title: "Doc", status: "ready" }).returning();
  const [chunk] = await db
    .insert(kbChunks)
    .values({ kbId: kb.id, documentId: doc.id, indexVersion: 1, ord: 0, ...values })
    .returning({ id: kbChunks.id });
  return chunk.id;
}

describe("test database", () => {
  it("starts empty and migrated for each test file", async () => {
    expect(await db.select().from(user)).toEqual([]);
    expect(process.env.DATABASE_URL).toMatch(/^pglite:memory#/);
  });

  it("enforces foreign keys: orphans are rejected", async () => {
    await expect(
      db.insert(channelMembers).values({ userId: crypto.randomUUID(), channelId: crypto.randomUUID() }),
    ).rejects.toThrow();
  });

  it("a write while this process holds an open transaction waits for it instead of dead-locking", async () => {
    const started = Date.now();
    const transaction = db.transaction(async (tx) => {
      await tx.insert(appKv).values({ key: "tx-1", value: 1 });
      await new Promise((resolve) => setTimeout(resolve, 100));
      await tx.insert(appKv).values({ key: "tx-2", value: 2 });
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const concurrentWrite = db.insert(appKv).values({ key: "outside", value: 3 });
    await Promise.all([transaction, concurrentWrite]);
    expect((await db.select().from(appKv)).map((row) => row.key).sort()).toEqual(["outside", "tx-1", "tx-2"]);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("stores 1536-dimension embeddings in a halfvec(1536) column", async () => {
    const vector = Array.from({ length: 1536 }, (_, i) => (i === 3 ? 1 : 0));
    const id = await addChunk({ content: "Hola", embedding: vector });
    const [row] = await db.select({ embedding: kbChunks.embedding }).from(kbChunks).where(eq(kbChunks.id, id));
    expect(row.embedding).toHaveLength(1536);
    expect(row.embedding?.[3]).toBe(1);
    const column = await one<{ type: string }>(
      db,
      sql`SELECT format_type(atttypid, atttypmod) AS type FROM pg_attribute WHERE attrelid = 'kb_chunks'::regclass AND attname = 'embedding'`,
    );
    expect(column.type).toBe("halfvec(1536)");
    expect((await one<{ n: number }>(db, sql`SELECT vector_dims(embedding) AS n FROM kb_chunks WHERE id = ${id}`)).n).toBe(1536);
  });

  it("keeps the key order of a contact's custom fields and a tool's parameters and headers (json, not jsonb)", async () => {
    const [contact] = await db.insert(contacts).values({ name: "Ana", customFields: { zeta: "1", alfa: "2" } }).returning({ id: contacts.id });
    const [storedContact] = await db.select({ customFields: contacts.customFields }).from(contacts).where(eq(contacts.id, contact.id));
    expect(Object.keys(storedContact.customFields)).toEqual(["zeta", "alfa"]);

    const [tool] = await db
      .insert(customTools)
      .values({ name: "consultar_pedido", url: "https://api.example.com/pedidos", parameters: { properties: {}, type: "object" }, headers: { "X-Zeta": "1", Accept: "json" } })
      .returning({ id: customTools.id });
    const [storedTool] = await db.select({ parameters: customTools.parameters, headers: customTools.headers }).from(customTools).where(eq(customTools.id, tool.id));
    // jsonb would give ["type", "properties"] (shorter keys first) and ["Accept", "X-Zeta"].
    expect(Object.keys(storedTool.parameters)).toEqual(["properties", "type"]);
    expect(Object.keys(storedTool.headers)).toEqual(["X-Zeta", "Accept"]);
  });

  it("has Row Level Security on every table of the public schema (a new table without it fails here)", async () => {
    const tables = rowsOf<{ name: string; rls: boolean }>(
      await db.execute(sql`
        SELECT c.relname AS name, c.relrowsecurity AS rls
        FROM pg_class AS c JOIN pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      `),
    );
    expect(tables.filter((table) => !table.rls).map((table) => table.name)).toEqual([]);
    // Not vacuous: every table of the schema is there.
    expect(tables.map((table) => table.name).sort()).toEqual(schemaTables().map((table) => getTableConfig(table).name).sort());
  });

  it("finds the extensions through the search_path and keeps them in the extensions schema", async () => {
    expect((await one<{ search_path: string }>(db, sql`SHOW search_path`)).search_path).toBe("public, extensions");
    const extensions = rowsOf<{ name: string; schema: string }>(
      await db.execute(sql`
        SELECT e.extname AS name, n.nspname AS schema
        FROM pg_extension AS e JOIN pg_namespace AS n ON n.oid = e.extnamespace
        WHERE e.extname IN ('vector', 'unaccent') ORDER BY 1
      `),
    );
    expect(extensions).toEqual([
      { name: "unaccent", schema: "extensions" },
      { name: "vector", schema: "extensions" },
    ]);
  });

  it("es_unaccent drops accents and reduces Spanish words to their stem, and search_vector uses it", async () => {
    expect((await one<{ v: string }>(db, sql`SELECT to_tsvector('public.es_unaccent', 'tintes')::text AS v`)).v).toBe("'tint':1");
    const same = await one<{ same: boolean }>(
      db,
      sql`SELECT to_tsvector('public.es_unaccent', 'Peluquería Ángela') = to_tsvector('public.es_unaccent', 'peluqueria angela') AS same`,
    );
    expect(same.same).toBe(true);
    const id = await addChunk({ title: "Tintes y mechas", content: "Peluquería Ángela" });
    const found = rowsOf<{ id: string }>(
      await db.execute(sql`SELECT id FROM kb_chunks WHERE search_vector @@ websearch_to_tsquery('public.es_unaccent', 'tinte peluqueria')`),
    );
    expect(found).toEqual([{ id }]);
  });

  it("a top-level transaction holds the write lock; nested transactions do not take it again", async () => {
    await db.transaction(async (tx) => {
      expect(await writeLocks(tx)).toBe(1);
      expect(await lockTimeout(tx)).toBe("15s");
      await tx.execute(sql`SET LOCAL lock_timeout = '1s'`);
      await tx.transaction(async (nested) => {
        expect(await writeLocks(nested)).toBe(1);
        // The nested one ran none of the lock statements: the outer transaction's setting is still there.
        expect(await lockTimeout(nested)).toBe("1s");
      });
    });
    expect(await writeLocks(db)).toBe(0);
  });

  it("a read-only top-level transaction takes no write lock, and cannot write", async () => {
    await db.transaction(
      async (tx) => {
        expect(await writeLocks(tx)).toBe(0);
        expect(await lockTimeout(tx)).not.toBe("15s");
      },
      { accessMode: "read only" },
    );
    await expect(
      db.transaction((tx) => tx.insert(appKv).values({ key: "read-only", value: 1 }), { accessMode: "read only" }),
    ).rejects.toThrow();
    expect(await db.select().from(appKv).where(eq(appKv.key, "read-only"))).toEqual([]);
  });

  it("tells a UNIQUE violation (SQLSTATE 23505) apart from other errors, through Drizzle's wrapper", async () => {
    await db.insert(appKv).values({ key: "unique", value: 1 });
    const duplicate = await db.insert(appKv).values({ key: "unique", value: 2 }).catch((error: unknown) => error);
    expect(isUniqueViolation(duplicate)).toBe(true);
    const orphan = await db
      .insert(channelMembers)
      .values({ userId: crypto.randomUUID(), channelId: crypto.randomUUID() })
      .catch((error: unknown) => error);
    expect(isUniqueViolation(orphan)).toBe(false);
    expect(isUniqueViolation(new Error("UNIQUE constraint failed"))).toBe(false);
  });

  it("reads the rows of a raw result from either driver", () => {
    expect(rowsOf([{ a: 1 }])).toEqual([{ a: 1 }]);
    expect(rowsOf({ rows: [{ a: 1 }], fields: [] })).toEqual([{ a: 1 }]);
    expect(() => rowsOf(undefined)).toThrow();
  });
});

describe("DATABASE_URL", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("empty or the old SQLite file: setting → the embedded database in ./data/pglite", () => {
    const embedded = { kind: "embedded", dataDir: path.resolve(EMBEDDED_DATABASE_DIR) };
    expect(resolveDatabaseTarget("")).toEqual(embedded);
    expect(resolveDatabaseTarget("  ")).toEqual(embedded);
    expect(resolveDatabaseTarget("file:./data/local.db")).toEqual(embedded);
    expect(isLegacyFileDatabaseUrl("file:./data/local.db")).toBe(true);
    expect(isLegacyFileDatabaseUrl("")).toBe(false);
  });

  it("pglite:<folder> → that folder; pglite:memory (with or without #id) → in memory", () => {
    expect(resolveDatabaseTarget("pglite:./data/e2e-pglite")).toEqual({ kind: "embedded", dataDir: path.resolve("./data/e2e-pglite") });
    expect(resolveDatabaseTarget("pglite:memory")).toEqual({ kind: "memory" });
    expect(resolveDatabaseTarget("pglite:memory#1234")).toEqual({ kind: "memory" });
  });

  it("postgres:// and postgresql:// → a server; nothing else is one", () => {
    const pooler = "postgresql://postgres.ref:secreto@aws-0-eu-west-1.pooler.supabase.com:6543/postgres";
    expect(resolveDatabaseTarget(pooler)).toEqual({ kind: "server", url: pooler });
    expect(resolveDatabaseTarget("postgres://u:p@db.example.com/app")).toEqual({ kind: "server", url: "postgres://u:p@db.example.com/app" });
    expect(isServerDatabase(pooler)).toBe(true);
    for (const url of ["", "file:./data/local.db", "pglite:memory", "libsql://x.turso.io"]) expect(isServerDatabase(url)).toBe(false);
  });

  it("libsql:// (Turso) and unknown URLs fail with a clear message that never repeats the URL", () => {
    expect(() => resolveDatabaseTarget("libsql://mi-base.turso.io?authToken=secreto")).toThrow(/Turso ya no se usa/);
    for (const url of ["mysql://u:secreto@host/db", ":memory:", "pglite:"]) {
      expect(() => resolveDatabaseTarget(url)).toThrow(/DATABASE_URL no es válida/);
      try {
        resolveDatabaseTarget(url);
      } catch (error) {
        expect((error as Error).message).not.toContain("secreto");
      }
    }
  });

  it("on Vercel only a server database works", () => {
    vi.stubEnv("VERCEL", "1");
    for (const url of ["", "file:./data/local.db", "pglite:./data/pglite", "pglite:memory"]) {
      expect(() => resolveDatabaseTarget(url)).toThrow(/Falta DATABASE_URL de Supabase/);
    }
    expect(resolveDatabaseTarget("postgresql://u:p@db.example.com/app").kind).toBe("server");
  });

  it("is read from the environment, trimmed", () => {
    vi.stubEnv("DATABASE_URL", "  postgresql://u:p@db.example.com/app  ");
    expect(databaseUrlFromEnv()).toBe("postgresql://u:p@db.example.com/app");
    expect(resolveDatabaseTarget().kind).toBe("server");
    expect(isServerDatabase()).toBe(true);
  });

  it("postgres.js: queries outside a transaction go one at a time on each connection (Supabase transaction pooler)", () => {
    const calls: unknown[][] = [];
    const client = { unsafe: (...args: unknown[]) => (calls.push(args), Promise.resolve([])) } as unknown as postgres.Sql;
    oneQueryAtATime(client);
    void client.unsafe("select $1::int", [1]);
    void client.unsafe("select 1");
    const [first, second] = calls as [string, unknown[], { onexecute: () => boolean }][];
    expect(first.slice(0, 2)).toEqual(["select $1::int", [1]]);
    expect(first[2].onexecute()).toBe(false);
    expect(second.slice(0, 2)).toEqual(["select 1", []]);
    expect(second[2].onexecute()).toBe(false);
  });

  it("postgres.js: no prepared statements (Supabase transaction pooler) and TLS except to this machine", () => {
    const options = serverConnectionOptions("postgresql://postgres.ref:pw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres");
    expect(options).toMatchObject({
      prepare: false,
      ssl: "require",
      max: 5,
      idle_timeout: 20,
      connect_timeout: 15,
      connection: { application_name: "dominia-agentes" },
    });
    expect(options.onnotice).toBeTypeOf("function");
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      expect(serverConnectionOptions(`postgres://postgres:postgres@${host}:5432/postgres`)).toMatchObject({ ssl: false, prepare: false });
    }
  });
});

describe("embedded database folder", () => {
  let dir = "";
  afterEach(async () => {
    if (dir) await removeWithRetry(dir);
    dir = "";
  });

  it("migrations apply from zero (folder and parent created), again as a no-op, taking over a dead process's lock", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dominia-db-test-"));
    const dataDir = path.join(dir, "data", "pglite");
    await migrateDatabase(`pglite:${dataDir}`);
    expect(fs.existsSync(path.join(dataDir, "PG_VERSION"))).toBe(true);
    expect(fs.existsSync(`${dataDir}.lock`)).toBe(false);

    // A lock left by a process that no longer exists (a dev server stopped with Ctrl+C) does not block.
    const deadPid = spawnSync(process.execPath, ["-e", ""]).pid;
    fs.writeFileSync(`${dataDir}.lock`, String(deadPid));
    await migrateDatabase(`pglite:${dataDir}`);
    expect(fs.existsSync(`${dataDir}.lock`)).toBe(false);

    const client = createPglite(dataDir);
    try {
      const journal = JSON.parse(fs.readFileSync(path.join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8")) as { entries: unknown[] };
      const applied = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations");
      expect(applied.rows[0].n).toBe(journal.entries.length);
      const tables = await client.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM pg_class AS c JOIN pg_namespace AS n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity",
      );
      expect(tables.rows[0].n).toBe(schemaTables().length);
    } finally {
      await client.close();
    }
  });

  it("refuses to open a folder another live process has open", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dominia-db-test-"));
    const dataDir = path.join(dir, "pglite");
    // The parent process (Vitest's) is certainly alive and is not this one.
    fs.writeFileSync(`${dataDir}.lock`, String(process.ppid));
    await expect(migrateDatabase(`pglite:${dataDir}`)).rejects.toThrow(
      /está abierta en otro proceso \(¿pnpm dev en marcha\?\)\. Ciérralo y vuelve a probar\./,
    );
    expect(fs.existsSync(dataDir)).toBe(false);
    expect(fs.readFileSync(`${dataDir}.lock`, "utf8")).toBe(String(process.ppid));
  });
});
