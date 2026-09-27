// The demo's knowledge documents of every sector and its precomputed embeddings ([ARR-12], [ARR-13]): the documents
// agree with the demo business, the fixtures file is read strictly and matched by key + model + size, `pnpm seed`
// stores the matching vectors so search by meaning works without embedding any chunk again, and
// `pnpm seed:embeddings` writes exactly the vectors the seed looks for (with a fake OpenRouter; tests never call it).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isNull } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { kbChunks, knowledgeBases } from "@/db/schema";
import { EMBEDDING_DIMENSIONS } from "@/db/schema/columns";
import { SECTORS, type Sector } from "@/lib/enums";
import { DEFAULT_MODELS } from "@/lib/openrouter/default-models";
import { getSectorPreset } from "@/lib/sectors";
import { decodeEmbedding, embeddingKey, encodeEmbedding } from "@/server/knowledge/embeddings";
import { documentsWithPendingEmbeddings } from "@/server/knowledge/maintenance";
import { searchKnowledge } from "@/server/knowledge/search";
import { bagOfWordsVector, embeddingCalls, knowledgeOpenRouter } from "@/server/knowledge/test-helpers";
import { FAKE_OPENROUTER_KEY, jsonResponse } from "@/test/fake-openrouter";
import { DEMO_BUSINESSES } from "../../seed/businesses";
import { buildDemoKnowledge, DEMO_DOCUMENTS, demoEmbeddingTexts, readDemoSource } from "../../seed/knowledge";
import { MISSING_KEY_MESSAGE, runSeedEmbeddingsCommand } from "../../seed/knowledge/embeddings-command";
import * as fixturesModule from "../../seed/knowledge/fixtures";
import { demoEmbeddingFor, emptyDemoEmbeddings, loadDemoEmbeddings, parseDemoEmbeddings, serializeDemoEmbeddings, type DemoEmbeddings } from "../../seed/knowledge/fixtures";
import { unsupportedPdfCharacters } from "../../seed/knowledge/pdf";
import { pickDemoSources } from "../../seed/knowledge/sources";
import { describeOpeningHours } from "../../seed/steps/conversation-scripts";
import { buildDemoKnowledgeRows } from "../../seed/steps/knowledge";
import { runSeedCommand } from "./seed-command";
import { captureOutput, emptyDatabase } from "./testing";

// The seed step reads the fixtures through this module: one test swaps the file's content for vectors of its own.
vi.mock("../../seed/knowledge/fixtures", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../seed/knowledge/fixtures")>();
  return { ...actual, loadDemoEmbeddings: vi.fn(actual.loadDemoEmbeddings) };
});

const MODEL = DEFAULT_MODELS.embeddings;
const DIMS = EMBEDDING_DIMENSIONS;
const REPOSITORY_FILE = path.join(process.cwd(), "seed", "fixtures", "embeddings.json");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dominia-demo-embeddings-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
afterEach(() => vi.unstubAllEnvs());

/** Fixtures with a bag-of-words vector for every demo chunk of these sectors (texts sharing words are close). */
async function fixturesFor(sectors: readonly Sector[], model = MODEL): Promise<DemoEmbeddings> {
  const items: Record<string, string> = {};
  for (const sector of sectors) {
    for (const { key, text } of demoEmbeddingTexts(await buildDemoKnowledge(sector), model, DIMS)) items[key] = encodeEmbedding(bagOfWordsVector(text));
  }
  return { ...emptyDemoEmbeddings(model), generatedAt: "2026-09-26T10:00:00.000Z", items };
}

const flat = (text: string) => text.replace(/\s+/g, " ");

describe("demo documents of every sector [ARR-10] [ARR-12]", () => {
  it.each(SECTORS)("%s: two documents that agree with the demo business, and the preset's FAQs", async (sector) => {
    const business = DEMO_BUSINESSES[sector];
    const preset = getSectorPreset(sector);
    const [prices, rules] = DEMO_DOCUMENTS[sector];
    const pricesText = readDemoSource(sector, prices.source);
    const rulesText = readDemoSource(sector, rules.source);

    // Every example price of the business is in its prices document, next to the service's name.
    for (const service of preset.services) {
      const price = business.servicePrices[service.key];
      if (price === undefined) continue;
      const line = pricesText.split("\n").find((candidate) => candidate.includes(`**${service.name}**`));
      expect(line, `${sector}: ${service.name}`).toBeDefined();
      expect(line).toContain(`${price} €`);
    }
    expect(pricesText).not.toMatch(/^# /m);
    // The PDF: its title, the business's contact data and the same opening hours as the agenda.
    expect(rulesText.split("\n")[0]).toBe(`# ${rules.title}`);
    for (const value of [business.address, business.contactPhone, business.contactEmail, business.website]) expect(rulesText, `${sector}: ${value}`).toContain(value);
    expect(flat(rulesText)).toContain(describeOpeningHours(preset.businessHours));
    expect(unsupportedPdfCharacters(rulesText)).toEqual([]);

    const knowledge = await buildDemoKnowledge(sector);
    expect(knowledge.documents.map((document) => document.title)).toEqual([prices.title, rules.title, ...preset.faqs.map((faq) => faq.question)]);
    const [markdown, pdf] = knowledge.documents;
    expect(markdown.file?.mimeType).toBe("text/markdown");
    expect(pdf.file?.mimeType).toBe("application/pdf");
    expect(pdf.pageCount).toBe(2);
    // Each PDF page is its own chunk, so the answers cite the right page ([CON-23]).
    expect(pdf.chunks.map((chunk) => chunk.page)).toEqual([1, 2]);
    for (const document of knowledge.documents) {
      expect(document.chunks.length, document.title).toBeGreaterThan(0);
      expect(document.summary.length, document.title).toBeGreaterThan(10);
      for (const chunk of document.chunks) expect(chunk.tokenCount, document.title).toBeLessThanOrEqual(600);
    }
  });

  it("is the same every time: the fixtures' keys keep matching", async () => {
    const first = demoEmbeddingTexts(await buildDemoKnowledge("peluqueria"), MODEL, DIMS);
    const second = demoEmbeddingTexts(await buildDemoKnowledge("peluqueria"), MODEL, DIMS);
    expect(second).toEqual(first);
    expect(first.every(({ key }) => /^[0-9a-f]{64}$/.test(key))).toBe(true);
  });

  it.each(SECTORS)("%s: the demo answers about hours, address and the voice note find their fragment", async (sector) => {
    const knowledge = await buildDemoKnowledge(sector);
    const candidates = knowledge.documents.flatMap((document) => document.chunks.map((chunk) => ({ ...chunk, title: document.title })));
    const business = DEMO_BUSINESSES[sector];
    const hours = pickDemoSources(`Hola, ¿qué horario tenéis?\n¡Hola! Abrimos ${describeOpeningHours(getSectorPreset(sector).businessHours)}. ¿Te ayudo en algo más?`, candidates);
    expect(flat(hours[0]?.candidate.content ?? "")).toContain(describeOpeningHours(getSectorPreset(sector).businessHours));
    const address = pickDemoSources(`¿Y dónde estáis?\nEstamos en ${business.address}. ¡Te esperamos!`, candidates);
    expect(flat(address[0]?.candidate.content ?? "")).toContain(business.address);
    expect(address.map((source) => source.rank)).toEqual(address.map((_, index) => index + 1));
    const scores = address.map((source) => source.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });
});

describe("the fixtures file [ARR-12] [ARR-13]", () => {
  it("the repository's file is valid, for the default model and 1536 dimensions", () => {
    const fixtures = loadDemoEmbeddings(REPOSITORY_FILE);
    expect(fixtures).toMatchObject({ version: 1, model: MODEL, dimensions: DIMS, encoding: "f32le-base64" });
    for (const value of Object.values(fixtures?.items ?? {})) expect(decodeEmbedding(value)).toHaveLength(DIMS);
  });

  it("no file is no fixtures; a broken or foreign file is an error, never half used", () => {
    expect(loadDemoEmbeddings(path.join(dir, "no-existe.json"))).toBeNull();
    expect(() => parseDemoEmbeddings("{ no es json")).toThrow(/no es un JSON válido/);
    expect(() => parseDemoEmbeddings(JSON.stringify({ ...emptyDemoEmbeddings(MODEL), encoding: "json" }))).toThrow(/formato esperado/);
    expect(() => parseDemoEmbeddings(JSON.stringify({ ...emptyDemoEmbeddings(MODEL), items: { "no-es-una-clave": "AAAA" } }))).toThrow(/formato esperado/);
    const text = serializeDemoEmbeddings({ ...emptyDemoEmbeddings(MODEL), items: { ["b".repeat(64)]: "AAAAAA==", ["a".repeat(64)]: "AAAAAA==" } });
    expect(text.indexOf("a".repeat(64))).toBeLessThan(text.indexOf("b".repeat(64)));
    expect(parseDemoEmbeddings(text).items).toHaveProperty("a".repeat(64));
  });

  it("a vector is used only for the same text, model and size, and only if it is a valid 1536 vector", () => {
    const text = "Documento: Servicios y precios > Color\n\nMechas: desde 65 €.";
    const vector = bagOfWordsVector(text);
    const key = embeddingKey(MODEL, DIMS, text);
    const fixtures: DemoEmbeddings = { ...emptyDemoEmbeddings(MODEL), items: { [key]: encodeEmbedding(vector) } };

    const found = demoEmbeddingFor(fixtures, { model: MODEL, dims: DIMS, text });
    expect(found.key).toBe(key);
    expect(found.embedding).toHaveLength(DIMS);
    found.embedding?.forEach((value, index) => expect(value).toBeCloseTo(vector[index], 6));

    expect(demoEmbeddingFor(fixtures, { model: MODEL, dims: DIMS, text: `${text} ` }).embedding).toBeNull();
    expect(demoEmbeddingFor(fixtures, { model: "openai/text-embedding-3-large", dims: DIMS, text })).toEqual({ key: embeddingKey("openai/text-embedding-3-large", DIMS, text), embedding: null });
    expect(demoEmbeddingFor({ ...fixtures, model: "otro/modelo" }, { model: MODEL, dims: DIMS, text }).embedding).toBeNull();
    expect(demoEmbeddingFor({ ...fixtures, dimensions: 768 }, { model: MODEL, dims: DIMS, text }).embedding).toBeNull();
    expect(demoEmbeddingFor({ ...fixtures, items: { [key]: encodeEmbedding(vector.slice(0, 768)) } }, { model: MODEL, dims: DIMS, text }).embedding).toBeNull();
    expect(demoEmbeddingFor(null, { model: MODEL, dims: DIMS, text })).toEqual({ key, embedding: null });
  });

  it("the seed rows take every matching vector, and none when the base uses another model", async () => {
    const knowledge = await buildDemoKnowledge("peluqueria");
    const fixtures = await fixturesFor(["peluqueria"]);
    const input = { dims: DIMS, fixtures, now: new Date("2026-09-26T10:00:00Z"), createdBy: null, agentIds: [] };
    const matched = buildDemoKnowledgeRows(knowledge, { ...input, model: MODEL });
    expect(matched.missingEmbeddings).toBe(0);
    expect(matched.chunks.every((chunk) => chunk.embedding?.length === DIMS)).toBe(true);
    const other = buildDemoKnowledgeRows(knowledge, { ...input, model: "openai/text-embedding-3-large" });
    expect(other.missingEmbeddings).toBe(other.chunks.length);
    expect(other.chunks.every((chunk) => chunk.embedding === null)).toBe(true);
  });
});

describe("pnpm seed with precomputed embeddings [ARR-12]", () => {
  beforeEach(async () => {
    await emptyDatabase();
  });

  it("stores them, so search by meaning works at once: only the question is embedded", async () => {
    vi.mocked(fixturesModule.loadDemoEmbeddings).mockReturnValueOnce(await fixturesFor(["peluqueria"]));
    const code = await runSeedCommand([], { out: captureOutput(), env: { DEMO_MODE: "true", NODE_ENV: "development" }, now: new Date("2026-09-26T10:00:00Z") });
    expect(code).toBe(0);

    expect(await db.select({ id: kbChunks.id }).from(kbChunks).where(isNull(kbChunks.embedding))).toEqual([]);
    expect(await documentsWithPendingEmbeddings()).toEqual([]);

    vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
    const fake = knowledgeOpenRouter();
    const [base] = await db.select().from(knowledgeBases);
    const result = await searchKnowledge({ kbIds: [base.id], query: "precio de las mechas y el tinte de raíz" }, { fetchImpl: fake.fetch });
    expect(result).toMatchObject({ status: "ok", mode: "hybrid" });
    expect(result.results[0].vectorScore).toBeGreaterThan(0);
    expect(result.results.map((item) => item.title)).toContain("Servicios y precios");
    // No chunk was embedded again: the only embeddings call is the question's.
    expect(embeddingCalls(fake)).toHaveLength(1);
    expect(embeddingCalls(fake)[0].body).toMatchObject({ input: ["precio de las mechas y el tinte de raíz"] });
  });
});

describe("pnpm seed:embeddings [ARR-13]", () => {
  const output = () => captureOutput();

  it("refuses without a key and changes nothing", async () => {
    const file = path.join(dir, "sin-clave.json");
    const fake = knowledgeOpenRouter();
    const out = output();
    expect(await runSeedEmbeddingsCommand({ env: {}, out, fetchImpl: fake.fetch, file })).toBe(1);
    expect(out.errors).toEqual([MISSING_KEY_MESSAGE]);
    expect(fs.existsSync(file)).toBe(false);
    expect(fake.calls).toEqual([]);
  });

  it("embeds every demo chunk of every sector in batches and writes the file the seed reads, never printing the key", async () => {
    const file = path.join(dir, "embeddings.json");
    const fake = knowledgeOpenRouter();
    const out = output();
    const now = new Date("2026-09-27T08:00:00Z");
    expect(await runSeedEmbeddingsCommand({ env: { OPENROUTER_API_KEY: FAKE_OPENROUTER_KEY }, out, fetchImpl: fake.fetch, file, now })).toBe(0);

    const calls = embeddingCalls(fake);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      const body = call.body as { model: string; input: string[]; dimensions: number; provider: Record<string, unknown> };
      expect(body).toMatchObject({ model: MODEL, dimensions: DIMS, provider: { data_collection: "deny" } });
      expect(body.input.length).toBeLessThanOrEqual(96);
    }
    expect(calls.every((call) => call.headers.get("authorization") === `Bearer ${FAKE_OPENROUTER_KEY}`)).toBe(true);
    expect(out.text()).not.toContain(FAKE_OPENROUTER_KEY);

    const written = loadDemoEmbeddings(file);
    expect(written).toMatchObject({ version: 1, model: MODEL, dimensions: DIMS, encoding: "f32le-base64", generatedAt: now.toISOString() });
    const keys = Object.keys(written?.items ?? {});
    expect(keys).toEqual([...keys].sort());
    expect(fs.readFileSync(file, "utf8").endsWith("}\n")).toBe(true);

    // Exactly the chunks of the nine sectors' demos, each with its own vector.
    const expected = new Set<string>();
    for (const sector of SECTORS) for (const { key } of demoEmbeddingTexts(await buildDemoKnowledge(sector), MODEL, DIMS)) expected.add(key);
    expect(new Set(keys)).toEqual(expected);
    expect(calls.reduce((sum, call) => sum + (call.body as { input: string[] }).input.length, 0)).toBe(expected.size);
    for (const sector of SECTORS) {
      const rows = buildDemoKnowledgeRows(await buildDemoKnowledge(sector), { model: MODEL, dims: DIMS, fixtures: written, now: new Date(), createdBy: null, agentIds: [] });
      expect(rows.missingEmbeddings, sector).toBe(0);
    }
    expect(out.lines.at(-1)).toMatch(/^Listo: \d+ embeddings guardados en seed\/fixtures\/embeddings\.json/);
  });

  it("a model that gives another size, or a rejected key, leaves the file as it was", async () => {
    const file = path.join(dir, "intacto.json");
    fs.writeFileSync(file, serializeDemoEmbeddings(emptyDemoEmbeddings(MODEL)));
    const before = fs.readFileSync(file, "utf8");

    const small = knowledgeOpenRouter({
      "POST /embeddings": (call) => {
        const body = call.body as { input: string[] };
        return jsonResponse({ object: "list", model: MODEL, data: body.input.map((_, index) => ({ object: "embedding", index, embedding: [0.1, 0.2, 0.3] })), usage: { prompt_tokens: 1, total_tokens: 1 } });
      },
    });
    const out = output();
    expect(await runSeedEmbeddingsCommand({ env: { OPENROUTER_API_KEY: FAKE_OPENROUTER_KEY }, out, fetchImpl: small.fetch, file })).toBe(1);
    expect(out.errors.join("\n")).toMatch(/No se ha cambiado nada\.$/);

    const rejected = knowledgeOpenRouter({ "POST /embeddings": () => jsonResponse({ error: { code: 401, message: `User not found for key ${FAKE_OPENROUTER_KEY}` } }, 401) });
    const second = output();
    expect(await runSeedEmbeddingsCommand({ env: { OPENROUTER_API_KEY: FAKE_OPENROUTER_KEY }, out: second, fetchImpl: rejected.fetch, file })).toBe(1);
    expect(second.errors.join("\n")).toMatch(/No se ha cambiado nada\.$/);
    expect(second.text()).not.toContain(FAKE_OPENROUTER_KEY);

    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });
});
