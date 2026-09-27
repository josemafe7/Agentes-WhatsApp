// The demo's knowledge base «Información del negocio» of each sector ([ARR-06], [ARR-12], [CON-04]–[CON-10]): the
// sector preset's FAQs and two documents of its fictional business, kept as text in seed/knowledge/<sector>/ (a
// Markdown file, and a «.pdf.md» source that becomes a PDF, so the demo cites pages). Everything is processed here as
// the app would process an upload without an OpenRouter key: same detection, extraction, two-sentence summary,
// chunking and embedding key. No network and no database: `pnpm seed` writes the result inside its transaction, and
// `pnpm seed:embeddings` computes the vectors of exactly these texts.
import fs from "node:fs";
import path from "node:path";
import type { Sector } from "@/lib/enums";
import { getSectorPreset } from "@/lib/sectors";
import { chunkMarkdown, embeddingInput, type ChunkDraft } from "@/server/knowledge/chunking";
import { embeddingKey } from "@/server/knowledge/embeddings";
import { detectKnowledgeFile, extractFileToMarkdown, KNOWLEDGE_MIME_TYPES, sha256Hex, type KnowledgeFileKind } from "@/server/knowledge/extract";
import { documentMarkdown } from "@/server/knowledge/ingest";
import { fallbackSummary } from "@/server/knowledge/summary";
import { DEMO_BUSINESSES } from "../businesses";
import type { DemoFile } from "../media";
import { parsePdfSource, textPdf } from "./pdf";

export const DEMO_KNOWLEDGE_DIR = path.join(process.cwd(), "seed", "knowledge");
export const DEMO_KNOWLEDGE_BASE_NAME = "Información del negocio";
/** FileStorage key prefix of the demo's documents: fixed keys, so loading the demo again overwrites them. */
export const DEMO_KNOWLEDGE_KEY_PREFIX = "knowledge/demo";

/** A document of the demo: its text source in seed/knowledge/<sector>/ and its title in the app. */
export type DemoDocumentSource = { source: string; title: string };

const PDF_SOURCE = /\.pdf\.md$/;

export const DEMO_DOCUMENTS: Readonly<Record<Sector, readonly DemoDocumentSource[]>> = {
  peluqueria: [
    { source: "servicios-y-precios.md", title: "Servicios y precios" },
    { source: "normas-y-como-llegar.pdf.md", title: "Normas de citas y cómo llegar" },
  ],
  "clinica-dental": [
    { source: "tratamientos-y-precios.md", title: "Tratamientos y precios" },
    { source: "citas-y-como-llegar.pdf.md", title: "Citas, cancelaciones y cómo llegar" },
  ],
  fisioterapia: [
    { source: "servicios-y-precios.md", title: "Servicios y precios" },
    { source: "antes-de-tu-sesion-y-como-llegar.pdf.md", title: "Antes de tu sesión y cómo llegar" },
  ],
  restaurante: [
    { source: "carta-y-menus.md", title: "Carta y menús" },
    { source: "reservas-y-como-llegar.pdf.md", title: "Reservas y cómo llegar" },
  ],
  taller: [
    { source: "servicios-y-precios.md", title: "Servicios y precios" },
    { source: "condiciones-y-como-llegar.pdf.md", title: "Condiciones del taller y cómo llegar" },
  ],
  academia: [
    { source: "cursos-y-precios.md", title: "Cursos y precios" },
    { source: "normas-y-como-llegar.pdf.md", title: "Normas de la academia y cómo llegar" },
  ],
  inmobiliaria: [
    { source: "servicios-y-honorarios.md", title: "Servicios y honorarios" },
    { source: "visitas-y-como-llegar.pdf.md", title: "Visitas, documentación y cómo llegar" },
  ],
  tienda: [
    { source: "catalogo-y-precios.md", title: "Catálogo y precios" },
    { source: "envios-cambios-y-como-llegar.pdf.md", title: "Envíos, cambios y cómo llegar" },
  ],
  otro: [
    { source: "servicios-y-tarifas.md", title: "Servicios y tarifas" },
    { source: "como-trabajamos-y-como-llegar.pdf.md", title: "Cómo trabajamos y cómo llegar" },
  ],
};

/** A demo document as the pipeline leaves it: «listo», with its Markdown, summary and chunks (without embeddings). */
export type DemoKnowledgeDocument = {
  sourceType: "file" | "faq";
  title: string;
  /** The uploaded file (documents), stored under a fixed key. */
  file: DemoFile | null;
  faqQuestion: string | null;
  contentMd: string;
  contentHash: string;
  checksum: string | null;
  pageCount: number | null;
  summary: string;
  chunks: ChunkDraft[];
};

export type DemoKnowledge = { sector: Sector; name: string; description: string; documents: DemoKnowledgeDocument[] };

/** The text source of a demo document, with \n line ends whatever Git did to the file. */
export function readDemoSource(sector: Sector, source: string): string {
  return fs.readFileSync(path.join(DEMO_KNOWLEDGE_DIR, sector, source), "utf8").replace(/\r\n?/g, "\n");
}

function uploadOf(sector: Sector, document: DemoDocumentSource): { file: DemoFile; kind: KnowledgeFileKind } {
  const text = readDemoSource(sector, document.source);
  const isPdf = PDF_SOURCE.test(document.source);
  const fileName = isPdf ? document.source.replace(PDF_SOURCE, ".pdf") : document.source;
  const bytes = isPdf ? textPdf(parsePdfSource(text), { title: document.title }) : new Uint8Array(Buffer.from(text, "utf8"));
  // Checked by extension and content, as an upload ([CON-04]).
  const kind = detectKnowledgeFile(fileName, bytes);
  if (!kind) throw new Error(`El documento de demo ${sector}/${document.source} no es un archivo que acepte una base de conocimiento.`);
  return { file: { fileKey: `${DEMO_KNOWLEDGE_KEY_PREFIX}/${sector}/${fileName}`, mimeType: KNOWLEDGE_MIME_TYPES[kind], fileName, bytes }, kind };
}

/** The bytes the business «uploaded»: the Markdown itself, or the PDF written from its source. */
export function demoDocumentFile(sector: Sector, document: DemoDocumentSource): DemoFile {
  return uploadOf(sector, document).file;
}

function processed(input: Omit<DemoKnowledgeDocument, "summary" | "chunks">): DemoKnowledgeDocument {
  const markdown = documentMarkdown({ sourceType: input.sourceType, title: input.title, faqQuestion: input.faqQuestion, contentMd: input.contentMd });
  const chunks = chunkMarkdown(markdown);
  if (chunks.length === 0) throw new Error(`El documento de demo «${input.title}» no tiene texto.`);
  return { ...input, summary: fallbackSummary(markdown), chunks };
}

async function fileDocument(sector: Sector, document: DemoDocumentSource): Promise<DemoKnowledgeDocument> {
  const { file, kind } = uploadOf(sector, document);
  const extracted = await extractFileToMarkdown(kind, file.bytes);
  return processed({
    sourceType: "file",
    title: document.title,
    file,
    faqQuestion: null,
    contentMd: extracted.markdown,
    contentHash: sha256Hex(extracted.markdown),
    checksum: sha256Hex(file.bytes),
    pageCount: extracted.pageCount,
  });
}

function faqDocument(question: string, answer: string): DemoKnowledgeDocument {
  return processed({
    sourceType: "faq",
    title: question,
    file: null,
    faqQuestion: question,
    contentMd: answer,
    contentHash: sha256Hex(`${question}\n${answer}`),
    checksum: null,
    pageCount: null,
  });
}

/** The knowledge base of a sector's demo: its documents first, then the preset's FAQs. */
export async function buildDemoKnowledge(sector: Sector): Promise<DemoKnowledge> {
  const business = DEMO_BUSINESSES[sector];
  const documents: DemoKnowledgeDocument[] = [];
  for (const document of DEMO_DOCUMENTS[sector]) documents.push(await fileDocument(sector, document));
  for (const faq of getSectorPreset(sector).faqs) documents.push(faqDocument(faq.question, faq.answer));
  return {
    sector,
    name: DEMO_KNOWLEDGE_BASE_NAME,
    description: `Servicios, precios, normas, cómo llegar y preguntas frecuentes de ${business.name}.`,
    documents,
  };
}

/** The exact text sent to the embeddings API for a demo chunk ([CON-10]), as the pipeline builds it. */
export function demoChunkText(document: Pick<DemoKnowledgeDocument, "title" | "summary">, chunk: Pick<ChunkDraft, "section" | "content">): string {
  return embeddingInput({ title: document.title, section: chunk.section, summary: document.summary, content: chunk.content });
}

/** Every chunk's key and embedding text for a model and size, in document order (repeated texts once). */
export function demoEmbeddingTexts(knowledge: DemoKnowledge, model: string, dims: number): { key: string; text: string }[] {
  const texts = new Map<string, string>();
  for (const document of knowledge.documents) {
    for (const chunk of document.chunks) {
      const text = demoChunkText(document, chunk);
      texts.set(embeddingKey(model, dims, text), text);
    }
  }
  return [...texts].map(([key, text]) => ({ key, text }));
}
