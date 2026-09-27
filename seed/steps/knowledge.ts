// Demo knowledge ([ARR-06], [ARR-12], [ARR-14], [CON-03], [CON-20], [AGE-07]): the base «Información del negocio» of
// the sector (seed/knowledge), already processed and «listo» as the pipeline would leave it without a key: chunks
// searchable by words at once (the FTS triggers index them as they are inserted) and, for every chunk whose key is in
// seed/fixtures/embeddings.json for the base's model and size, its stored vector, so search by meaning works as soon
// as there is a key, without processing anything again. The base goes to every demo agent, and a few demo AI answers
// get the fragments they «used» for «¿Por qué respondió esto?», with buscar_conocimiento in their AI run as it would be
// live. Like the other steps, nothing is scheduled and nothing calls the AI: chunks left without a vector are filled
// by the pending-embeddings job once a key is saved.
import { and, asc, eq } from "drizzle-orm";
import { DEFAULT_AI_DISCLOSURE_TEXT } from "@/data/legal-texts";
import { loadBusinessSettings, loadIntegrationSettings } from "@/data/settings";
import type { Transaction } from "@/db";
import { agentKnowledgeBases, aiRuns, kbChunks, kbDocuments, knowledgeBases, messageRetrievals, messages } from "@/db/schema";
import { EMBEDDING_DIMENSIONS } from "@/db/schema/columns";
import type { SystemToolName } from "@/lib/agent-tools";
import { DEFAULT_MODELS } from "@/lib/openrouter/default-models";
import { buildDemoKnowledge, demoChunkText, type DemoKnowledge } from "../knowledge";
import { demoEmbeddingFor, loadDemoEmbeddings, type DemoEmbeddings } from "../knowledge/fixtures";
import { pickDemoSources, type SourceCandidate } from "../knowledge/sources";
import { writeDemoMedia } from "../media";
import type { SeedContext, SeedStep } from "../types";
import { DEMO_USERS } from "../users";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
/** Rows per insert: chunks carry a 1536-number vector each. */
const INSERT_BATCH = 20;

/** Demo conversations (keys of seed/steps/conversations.ts) whose AI answers show the fragments they used. */
export const DEMO_SOURCED_CONVERSATIONS = ["nota-de-voz", "preguntas"] as const;

/** The tool a sourced demo answer called before answering ([HER-01]): one search step, then the answer. */
const KNOWLEDGE_TOOL: SystemToolName = "buscar_conocimiento";

export type DemoChunkRow = typeof kbChunks.$inferInsert & { id: string; kbId: string; documentId: string };
export type DemoSourceCandidate = SourceCandidate & { chunkId: string; documentId: string; kbId: string; page: number | null };

export type DemoKnowledgeRows = {
  base: typeof knowledgeBases.$inferInsert & { id: string };
  documents: (typeof kbDocuments.$inferInsert)[];
  chunks: DemoChunkRow[];
  links: (typeof agentKnowledgeBases.$inferInsert)[];
  candidates: DemoSourceCandidate[];
  /** Chunks without a stored vector (the fixtures lack their key, or are for another model). */
  missingEmbeddings: number;
};

export type DemoKnowledgeRowsInput = {
  model: string;
  dims: number;
  fixtures: DemoEmbeddings | null;
  now: Date;
  createdBy: string | null;
  agentIds: readonly string[];
};

/** The rows of the demo base, as the app leaves an uploaded document once processed. Pure except for new ids. */
export function buildDemoKnowledgeRows(knowledge: DemoKnowledge, input: DemoKnowledgeRowsInput): DemoKnowledgeRows {
  const daysAgo = (days: number, offsetMs = 0) => new Date(input.now.getTime() - days * DAY_MS + offsetMs);
  const kbId = crypto.randomUUID();
  const rows: DemoKnowledgeRows = {
    base: {
      id: kbId,
      name: knowledge.name,
      description: knowledge.description,
      embeddingModel: input.model,
      embeddingDims: input.dims,
      indexVersion: 1,
      buildingIndexVersion: null,
      searchMode: "hybrid",
      createdAt: daysAgo(21),
      updatedAt: daysAgo(19),
    },
    documents: [],
    chunks: [],
    links: input.agentIds.map((agentId) => ({ agentId, knowledgeBaseId: kbId, createdAt: daysAgo(2), updatedAt: daysAgo(2) })),
    candidates: [],
    missingEmbeddings: 0,
  };

  knowledge.documents.forEach((document, index) => {
    const documentId = crypto.randomUUID();
    const at = daysAgo(document.sourceType === "faq" ? 19 : 20, index * MINUTE_MS);
    rows.documents.push({
      id: documentId,
      kbId,
      sourceType: document.sourceType,
      title: document.title,
      fileKey: document.file?.fileKey ?? null,
      fileName: document.file?.fileName ?? null,
      mimeType: document.file?.mimeType ?? null,
      sizeBytes: document.file?.bytes.byteLength ?? null,
      faqQuestion: document.faqQuestion,
      contentMd: document.contentMd,
      status: "ready",
      error: null,
      checksum: document.checksum,
      contentHash: document.contentHash,
      pageCount: document.pageCount,
      summary: document.summary,
      createdBy: input.createdBy,
      createdAt: at,
      updatedAt: at,
    });
    for (const chunk of document.chunks) {
      const { key, embedding } = demoEmbeddingFor(input.fixtures, { model: input.model, dims: input.dims, text: demoChunkText(document, chunk) });
      if (!embedding) rows.missingEmbeddings += 1;
      const id = crypto.randomUUID();
      rows.chunks.push({
        id,
        kbId,
        documentId,
        indexVersion: 1,
        ord: chunk.ord,
        title: document.title,
        section: chunk.section,
        page: chunk.page,
        content: chunk.content,
        tokenCount: chunk.tokenCount,
        embedding,
        contentHash: key,
        createdAt: at,
        updatedAt: at,
      });
      rows.candidates.push({ chunkId: id, documentId, kbId, title: document.title, section: chunk.section, page: chunk.page, content: chunk.content });
    }
  });
  return rows;
}

/** Parents before children: foreign keys are enforced and nothing relies on cascades. */
async function insertDemoKnowledge(tx: Transaction, rows: DemoKnowledgeRows): Promise<void> {
  await tx.insert(knowledgeBases).values(rows.base);
  await tx.insert(kbDocuments).values(rows.documents);
  // Plain inserts (never INSERT OR REPLACE): the FTS triggers index each chunk ([CON-12]).
  for (let start = 0; start < rows.chunks.length; start += INSERT_BATCH) await tx.insert(kbChunks).values(rows.chunks.slice(start, start + INSERT_BATCH));
  if (rows.links.length > 0) await tx.insert(agentKnowledgeBases).values(rows.links);
}

/** The customer's words before an answer: their text, or the transcript of their voice note. */
const customerWords = (message: { text: string | null; transcript: string | null }) => message.text ?? message.transcript ?? "";

/** «¿Por qué respondió esto?» for the AI answers of a few demo conversations ([CON-20]). */
async function insertDemoSources(tx: Transaction, ctx: SeedContext, rows: DemoKnowledgeRows): Promise<number> {
  const settings = await loadBusinessSettings(tx);
  const disclosure = settings.aiDisclosureText?.trim() || DEFAULT_AI_DISCLOSURE_TEXT;
  let answered = 0;
  for (const key of DEMO_SOURCED_CONVERSATIONS) {
    const conversationId = ctx.refs.conversationIds?.get(key);
    if (!conversationId) continue;
    const thread = await tx
      .select({ id: messages.id, senderType: messages.senderType, text: messages.text, transcript: messages.transcript, metadata: messages.metadata, createdAt: messages.createdAt })
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt));
    let question = "";
    for (const message of thread) {
      if (message.senderType === "contact") question = customerWords(message);
      if (message.senderType !== "ai" || message.metadata.handoff === true || !message.text) continue;
      const answer = message.text.startsWith(disclosure) ? message.text.slice(disclosure.length) : message.text;
      const sources = pickDemoSources(`${question}\n${answer}`, rows.candidates);
      if (sources.length === 0) continue;
      await tx.insert(messageRetrievals).values(
        sources.map(({ candidate, rank, score }) => ({
          messageId: message.id,
          chunkId: candidate.chunkId,
          documentId: candidate.documentId,
          kbId: candidate.kbId,
          rank,
          score,
          title: candidate.title,
          section: candidate.section,
          page: candidate.page,
          createdAt: message.createdAt,
          updatedAt: message.createdAt,
        })),
      );
      // Its AI run says so, as a live «Automático» answer would: the search, then the answer ([MOT-11]).
      await tx
        .update(aiRuns)
        .set({ toolsUsed: [{ name: KNOWLEDGE_TOOL, ok: true }], steps: 2 })
        .where(and(eq(aiRuns.messageId, message.id), eq(aiRuns.kind, "chat")));
      answered += 1;
    }
  }
  return answered;
}

export const knowledgeStep: SeedStep = {
  name: "conocimiento",
  prepare: async (ctx) => {
    // Extraction and chunking (no network, no database) and the files, outside the transaction: fixed keys, so
    // loading the demo again just overwrites them.
    const knowledge = await buildDemoKnowledge(ctx.sector);
    const fixtures = loadDemoEmbeddings();
    await writeDemoMedia(knowledge.documents.flatMap((document) => (document.file ? [document.file] : [])));

    return async (tx) => {
      const agentIds = ctx.refs.agentIds;
      if (!agentIds) throw new Error("El conocimiento de la demo necesita los agentes: ese paso va antes.");
      const owner = DEMO_USERS.find((candidate) => candidate.role === "owner");
      // Read inside the transaction: the settings step of this same load may have (re)created the row.
      const { defaultModels } = await loadIntegrationSettings(tx);
      const rows = buildDemoKnowledgeRows(knowledge, {
        model: defaultModels.embeddings || DEFAULT_MODELS.embeddings,
        dims: EMBEDDING_DIMENSIONS,
        fixtures,
        now: ctx.now,
        createdBy: owner ? (ctx.refs.userIds.get(owner.email) ?? null) : null,
        agentIds: [...agentIds.values()],
      });
      await insertDemoKnowledge(tx, rows);
      await insertDemoSources(tx, ctx, rows);
      if (rows.missingEmbeddings > 0 && !process.env.VITEST) {
        console.log(
          `Conocimiento de la demo: ${rows.missingEmbeddings} de ${rows.chunks.length} fragmentos sin embeddings guardados. La búsqueda funciona por palabras; para buscar también por significado, ejecuta pnpm seed:embeddings con la clave de OpenRouter en .env.local.`,
        );
      }
    };
  },
};
