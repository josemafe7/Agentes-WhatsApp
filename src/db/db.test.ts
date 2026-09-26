import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { appKv, channelMembers, kbChunks, kbDocuments, knowledgeBases, user } from "@/db/schema";

describe("test database", () => {
  it("starts empty and migrated for each test file", async () => {
    expect(await db.select().from(user)).toEqual([]);
    expect(process.env.DATABASE_URL).toMatch(/^file:.*dominia-vitest-/);
  });

  it("enforces foreign keys on its connections: orphans are rejected", async () => {
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

  it("stores F32_BLOB(1536) embeddings through the vector column", async () => {
    const [kb] = await db.insert(knowledgeBases).values({ name: "Base" }).returning();
    const [doc] = await db
      .insert(kbDocuments)
      .values({ kbId: kb.id, sourceType: "text", title: "Doc", status: "ready" })
      .returning();
    const vector = Array.from({ length: 1536 }, (_, i) => (i === 3 ? 1 : 0));
    const [chunk] = await db
      .insert(kbChunks)
      .values({ kbId: kb.id, documentId: doc.id, indexVersion: 1, ord: 0, content: "Hola", embedding: vector })
      .returning({ id: kbChunks.id });
    const [row] = await db.select({ embedding: kbChunks.embedding }).from(kbChunks).where(eq(kbChunks.id, chunk.id));
    expect(row.embedding).toHaveLength(1536);
    expect(row.embedding?.[3]).toBe(1);
    const [bytes] = await db.all<{ n: number }>(sql`SELECT length(embedding) AS n FROM kb_chunks`);
    expect(bytes.n).toBe(1536 * 4);
  });
});
