import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { kbChunks, kbDocuments, knowledgeBases } from "@/db/schema";
import { EMBEDDING_DIMENSIONS } from "@/db/schema/columns";
import { buildFtsQuery, PgTextSearch } from "./text-search";
import { InvalidEmbeddingError, PgVectorSearch } from "./vector-search";

/** Synthetic 1536-dim vector: weight 1 on axis `i` plus optional smaller weights. */
function vec(weights: Record<number, number>): number[] {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (const [axis, weight] of Object.entries(weights)) v[Number(axis)] = weight;
  return v;
}

const ids: Record<string, string> = {};
let kbA = "";
let kbB = "";

async function addChunk(name: string, kbId: string, indexVersion: number, content: string, embedding: number[] | null) {
  const [doc] = await db
    .insert(kbDocuments)
    .values({ kbId, sourceType: "text", title: name, status: "ready" })
    .returning({ id: kbDocuments.id });
  const [chunk] = await db
    .insert(kbChunks)
    .values({ kbId, documentId: doc.id, indexVersion, ord: 0, title: name, content, embedding })
    .returning({ id: kbChunks.id });
  ids[name] = chunk.id;
}

beforeAll(async () => {
  [{ id: kbA }] = await db.insert(knowledgeBases).values({ name: "Peluquería" }).returning({ id: knowledgeBases.id });
  [{ id: kbB }] = await db.insert(knowledgeBases).values({ name: "Otra" }).returning({ id: knowledgeBases.id });
  await addChunk("depilacion", kbA, 1, "La depilación láser cuesta 30 euros por sesión.", vec({ 0: 1 }));
  await addChunk("tinte", kbA, 1, "El tinte de pelo cuesta 25 euros.", vec({ 1: 1 }));
  await addChunk("mixto", kbA, 1, "Pack de depilación y tinte.", vec({ 0: 0.6, 1: 0.8 }));
  await addChunk("mechas", kbA, 1, "Mechas californianas y balayage.", null);
  await addChunk("cancelaciones", kbA, 1, "Las cancelaciones con menos de 24 horas no se cobran.", null);
  await addChunk("nueva-version", kbA, 2, "Depilación con cera (versión nueva del índice).", vec({ 0: 1 }));
  await addChunk("otra-base", kbB, 1, "Depilación en otro negocio.", vec({ 0: 1 }));
});

const scopeA = { kbs: [{ kbId: "", indexVersion: 1 }] };
beforeAll(() => {
  scopeA.kbs[0].kbId = kbA;
});

describe("buildFtsQuery [CON-16]", () => {
  it("builds an OR of keywords and their other number, without stop words or repeats", () => {
    expect(buildFtsQuery("¿Cuánto cuesta el tinte y el TINTE de mechas?")).toBe("cuesta or cuestas or tinte or tintes or mechas or mecha");
  });

  it("neutralises websearch syntax and quotes in the input", () => {
    expect(buildFtsQuery('"precio" OR -tinte')).toBe("precio or precios or or or tinte or tintes");
  });

  it("returns null when nothing is left to search", () => {
    expect(buildFtsQuery("de la que")).toBeNull();
    expect(buildFtsQuery("¿?!")).toBeNull();
  });

  it("plural after a vowel or a consonant, singular without «s» or «es»; short words and numbers stay as they are", () => {
    expect(buildFtsQuery("cancelacion colores")).toBe("cancelacion or cancelaciones or colores or colore or color");
    expect(buildFtsQuery("mes 25 or")).toBe("mes or 25 or or");
  });

  it("compares with the stop words keeping «ñ»: «uña» is not «una»", () => {
    expect(buildFtsQuery('uña "rara"')).toBe("uña or uñas or rara or raras");
  });
});

describe("PgTextSearch", () => {
  const search = new PgTextSearch();

  it("ignores accents and case: «depilacion» finds «depilación» [CON-17]", async () => {
    const hits = await search.search("DEPILACION", scopeA);
    expect(hits.map((h) => h.chunkId).sort()).toEqual([ids.depilacion, ids.mixto].sort());
  });

  it("any of the words is enough (OR), best matches first [CON-16]", async () => {
    const hits = await search.search("precio mechas balayage tinte", scopeA);
    expect(hits.map((h) => h.chunkId)).toContain(ids.mechas);
    expect(hits.map((h) => h.chunkId)).toContain(ids.tinte);
    expect(hits[0].score).toBeGreaterThanOrEqual(hits[hits.length - 1].score);
  });

  it("ranks first the fragment with more of the words", async () => {
    const hits = await search.search("depilación láser", scopeA);
    expect(hits.map((h) => h.chunkId)).toEqual([ids.depilacion, ids.mixto]);
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });

  it("searches only the given bases and index versions", async () => {
    const hits = await search.search("depilación", scopeA);
    expect(hits.map((h) => h.chunkId)).not.toContain(ids["nueva-version"]);
    expect(hits.map((h) => h.chunkId)).not.toContain(ids["otra-base"]);
    const both = await search.search("depilación", { kbs: [...scopeA.kbs, { kbId: kbB, indexVersion: 1 }] });
    expect(both.map((h) => h.chunkId)).toContain(ids["otra-base"]);
    expect(await search.search("depilación", { kbs: [] })).toEqual([]);
  });

  it("finds other forms of a Spanish word: a plural finds the singular and back (es_unaccent stems)", async () => {
    expect((await search.search("tintes", scopeA)).map((h) => h.chunkId)).toContain(ids.tinte);
    expect((await search.search("mecha", scopeA)).map((h) => h.chunkId)).toEqual([ids.mechas]);
    // es_unaccent stems these two apart (cancelacion, cancel): both forms are searched.
    expect((await search.search("cancelación", scopeA)).map((h) => h.chunkId)).toEqual([ids.cancelaciones]);
  });

  it("never fails on hostile input", async () => {
    await expect(search.search('"; DROP TABLE kb_chunks; -- * NEAR(', scopeA)).resolves.toBeInstanceOf(Array);
    expect(await search.search("de la", scopeA)).toEqual([]);
    // «-» would be NOT in websearch syntax: here it is just a separator.
    expect((await search.search("-tinte", scopeA)).map((h) => h.chunkId)).toContain(ids.tinte);
  });

  it("returns ids and scores only, never the embeddings [CON-19]", async () => {
    const [hit] = await search.search("tinte", scopeA);
    expect(Object.keys(hit).sort()).toEqual(["chunkId", "score"]);
  });

  it("stays in sync on update and delete, and survives a rebuild", async () => {
    await db.update(kbChunks).set({ content: "Tinte vegetal sin amoniaco." }).where(eq(kbChunks.id, ids.tinte));
    expect((await search.search("amoniaco", scopeA)).map((h) => h.chunkId)).toEqual([ids.tinte]);
    await search.rebuild();
    expect((await search.search("amoniaco", scopeA)).map((h) => h.chunkId)).toEqual([ids.tinte]);
  });
});

describe("PgVectorSearch", () => {
  it("exact search ranks by cosine similarity and filters by base, version and missing embeddings", async () => {
    const search = new PgVectorSearch();
    const hits = await search.search(vec({ 0: 1, 1: 0.1 }), scopeA);
    expect(hits.map((h) => h.chunkId)).toEqual([ids.depilacion, ids.mixto, ids.tinte]);
    expect(hits[0].score).toBeGreaterThan(0.99);
    expect(hits[0].score).toBeLessThanOrEqual(1);
  });

  it("the vector index path returns the same results", async () => {
    const indexed = new PgVectorSearch({ exactThreshold: 0 });
    const hits = await indexed.search(vec({ 0: 1, 1: 0.1 }), { ...scopeA, limit: 2 });
    expect(hits.map((h) => h.chunkId)).toEqual([ids.depilacion, ids.mixto]);
  });

  it("completes with the exact search when the index filter leaves too few results", async () => {
    // k = 1: the nearest neighbour overall may belong to another base or version.
    const tiny = new PgVectorSearch({ exactThreshold: 0, topK: 1 });
    const hits = await tiny.search(vec({ 0: 1 }), { kbs: [{ kbId: kbB, indexVersion: 1 }] });
    expect(hits.map((h) => h.chunkId)).toEqual([ids["otra-base"]]);
  });

  it("rejects embeddings that are not 1536 finite numbers [CON-11]", async () => {
    const search = new PgVectorSearch();
    await expect(search.search([1, 2, 3], scopeA)).rejects.toThrow(InvalidEmbeddingError);
    await expect(search.search(vec({ 0: Number.NaN }), scopeA)).rejects.toThrow(InvalidEmbeddingError);
  });

  it("returns ids and scores only, never the embeddings [CON-19]", async () => {
    for (const search of [new PgVectorSearch(), new PgVectorSearch({ exactThreshold: 0 })]) {
      const [hit] = await search.search(vec({ 1: 1 }), scopeA);
      expect(Object.keys(hit).sort()).toEqual(["chunkId", "score"]);
    }
  });

  it("rebuild reindexes without changing results", async () => {
    const search = new PgVectorSearch({ exactThreshold: 0 });
    await search.rebuild();
    expect((await search.search(vec({ 1: 1 }), { ...scopeA, limit: 1 })).map((h) => h.chunkId)).toEqual([ids.tinte]);
  });
});
