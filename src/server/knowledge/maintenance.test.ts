import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureSettingsRows } from "@/data/settings";
import { db } from "@/db";
import { integrationSettings, jobs, kbChunks, kbDocuments, knowledgeBases } from "@/db/schema";
import { getJobRegistration } from "@/server/jobs/registry";
import type { WebTransport } from "@/server/web-fetch";
import { FAKE_OPENROUTER_KEY } from "@/test/fake-openrouter";
import "./jobs";
import { addSitemapPages, backfillEmbeddings, documentsWithPendingEmbeddings, refreshDuePages, resumePendingEmbeddings } from "./maintenance";
import { KNOWLEDGE_EMBEDDINGS_JOB, KNOWLEDGE_PROCESS_JOB, KNOWLEDGE_REFRESH_JOB, KNOWLEDGE_REINDEX_JOB, KNOWLEDGE_SITEMAP_JOB, scheduleEmbeddingsBackfill, scheduleUrlRefresh } from "./queue";
import { budget, knowledgeOpenRouter } from "./test-helpers";

let kbId = "";
const publicDns = async () => [{ address: "93.184.216.34", family: 4 }];

beforeEach(async () => {
  await ensureSettingsRows();
  for (const table of [kbChunks, kbDocuments, knowledgeBases, jobs]) await db.delete(table);
  await db.update(integrationSettings).set({ openrouterKeyEnc: null });
  [{ id: kbId }] = await db.insert(knowledgeBases).values({ name: "Peluquería" }).returning({ id: knowledgeBases.id });
});

const pending = (type: string) => db.select({ runAt: jobs.runAt, payload: jobs.payload }).from(jobs).where(eq(jobs.type, type));

describe("knowledge jobs are registered [MOT-15]", () => {
  it("every job type has its handler", () => {
    for (const type of [KNOWLEDGE_PROCESS_JOB, KNOWLEDGE_REINDEX_JOB, KNOWLEDGE_SITEMAP_JOB, KNOWLEDGE_EMBEDDINGS_JOB, KNOWLEDGE_REFRESH_JOB]) {
      expect(getJobRegistration(type)).toBeDefined();
    }
  });
});

describe("web refresh [CON-09]", () => {
  it("queues the pages whose refresh is due, keeping their hash, and says when the next one is due", async () => {
    const now = new Date("2026-09-30T09:00:00Z");
    const [due] = await db
      .insert(kbDocuments)
      .values({ kbId, sourceType: "url", title: "a", url: "https://a.example/", status: "ready", contentHash: "abc", refreshEnabled: true, refreshIntervalHours: 24, nextRefreshAt: new Date("2026-09-30T08:00:00Z") })
      .returning();
    await db
      .insert(kbDocuments)
      .values({ kbId, sourceType: "url", title: "b", url: "https://b.example/", status: "ready", refreshEnabled: true, refreshIntervalHours: 48, nextRefreshAt: new Date("2026-10-01T09:00:00Z") });
    await db.insert(kbDocuments).values({ kbId, sourceType: "url", title: "c", url: "https://c.example/", status: "ready", refreshEnabled: false, nextRefreshAt: new Date("2026-09-01T00:00:00Z") });
    const next = await refreshDuePages(now);
    const [row] = await db.select().from(kbDocuments).where(eq(kbDocuments.id, due.id));
    expect(row).toMatchObject({ status: "queued", contentHash: "abc" });
    expect(row.nextRefreshAt?.toISOString()).toBe("2026-10-01T09:00:00.000Z");
    expect((await pending(KNOWLEDGE_PROCESS_JOB)).map((job) => job.payload)).toEqual([{ documentId: due.id }]);
    expect(next?.toISOString()).toBe("2026-10-01T09:00:00.000Z");
  });

  it("the refresh job is never planned later than the earliest due page", async () => {
    await scheduleUrlRefresh(new Date("2026-10-05T00:00:00Z"));
    await scheduleUrlRefresh(new Date("2026-10-02T00:00:00Z"));
    await scheduleUrlRefresh(new Date("2026-10-09T00:00:00Z"));
    const rows = await db.select({ runAt: jobs.runAt, status: jobs.status }).from(jobs).where(eq(jobs.type, KNOWLEDGE_REFRESH_JOB));
    expect(rows.filter((job) => job.status === "pending").map((job) => job.runAt.toISOString())).toEqual(["2026-10-02T00:00:00.000Z"]);
  });
});

describe("sitemap pages [CON-04]", () => {
  it("adds the pages as URL documents, skipping those already in the base, each queued", async () => {
    await db.insert(kbDocuments).values({ kbId, sourceType: "url", title: "Inicio", url: "https://ana.example/", status: "ready" });
    const xml = "<urlset><url><loc>https://ana.example/</loc></url><url><loc>https://ana.example/precios</loc></url><url><loc>https://ana.example/equipo</loc></url></urlset>";
    const webFetch: WebTransport = async () => new Response(xml, { status: 200, headers: { "content-type": "application/xml" } });
    const added = await addSitemapPages(
      { kbId, sitemapUrl: "https://ana.example/sitemap.xml", maxPages: 50, refreshIntervalHours: 72, createdBy: null },
      { webFetch, resolveHost: publicDns },
    );
    expect(added).toBe(2);
    const docs = await db.select({ url: kbDocuments.url, sitemapUrl: kbDocuments.sitemapUrl, status: kbDocuments.status, refreshEnabled: kbDocuments.refreshEnabled }).from(kbDocuments).where(eq(kbDocuments.status, "queued"));
    expect(docs.map((doc) => doc.url).sort()).toEqual(["https://ana.example/equipo", "https://ana.example/precios"]);
    expect(docs.every((doc) => doc.sitemapUrl === "https://ana.example/sitemap.xml" && doc.refreshEnabled)).toBe(true);
    expect(await pending(KNOWLEDGE_PROCESS_JOB)).toHaveLength(2);
  });
});

describe("pending embeddings [CON-12]", () => {
  it("one pending job, moved to now when a key is saved", async () => {
    await scheduleEmbeddingsBackfill();
    const [later] = await pending(KNOWLEDGE_EMBEDDINGS_JOB);
    expect(later.runAt.getTime()).toBeGreaterThan(Date.now() + 60_000);
    await scheduleEmbeddingsBackfill({ now: true });
    const rows = await db.select({ runAt: jobs.runAt, status: jobs.status }).from(jobs).where(eq(jobs.type, KNOWLEDGE_EMBEDDINGS_JOB));
    const active = rows.filter((job) => job.status === "pending");
    expect(active).toHaveLength(1);
    expect(active[0].runAt.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe("pending embeddings when the key is only in the environment [CON-12] [ARR-15]", () => {
  afterEach(() => vi.unstubAllEnvs());

  /** A ready document whose chunk was stored without a vector (no key at the time, or the demo without fixtures). */
  async function readyWithoutEmbedding() {
    const [doc] = await db.insert(kbDocuments).values({ kbId, sourceType: "text", title: "Tarifas", contentMd: "El tinte cuesta 40 euros.", status: "ready" }).returning();
    await db.insert(kbChunks).values({ kbId, documentId: doc.id, indexVersion: 1, ord: 0, title: "Tarifas", content: "El tinte cuesta 40 euros.", tokenCount: 8 });
    return doc.id;
  }

  it("on start-up with a key in OPENROUTER_API_KEY, the pending-embeddings job is queued at once and fills them", async () => {
    await readyWithoutEmbedding();
    vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
    expect(await resumePendingEmbeddings()).toBe(true);
    const [job] = await pending(KNOWLEDGE_EMBEDDINGS_JOB);
    expect(job.runAt.getTime()).toBeLessThanOrEqual(Date.now());
    const fake = knowledgeOpenRouter();
    expect(await backfillEmbeddings(budget(), { fetchImpl: fake.fetch })).toBe("done");
    expect(await documentsWithPendingEmbeddings()).toEqual([]);
  });

  it("without a key, or with nothing pending, nothing is queued", async () => {
    expect(await resumePendingEmbeddings()).toBe(false);
    await readyWithoutEmbedding();
    vi.stubEnv("OPENROUTER_API_KEY", "");
    expect(await resumePendingEmbeddings()).toBe(false);
    expect(await pending(KNOWLEDGE_EMBEDDINGS_JOB)).toEqual([]);
  });
});
