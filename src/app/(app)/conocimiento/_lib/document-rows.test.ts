// Rows of the documents table: what each column shows and the Mistral OCR hint of a scanned PDF ([CON-05], [CON-07]).
import { describe, expect, it } from "vitest";
import type { KnowledgeDocumentItem } from "@/data/knowledge-documents";
import { actorFor } from "@/test/factories";
import { mistralKeyHintFor, toDocumentRows } from "./document-rows";

const NOW = new Date("2026-09-27T10:00:00Z");

function doc(overrides: Partial<KnowledgeDocumentItem>): KnowledgeDocumentItem {
  return {
    id: "d1",
    kbId: "kb1",
    sourceType: "file",
    title: "Tarifas 2026",
    fileName: "Tarifas 2026.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1_000,
    url: null,
    sitemapUrl: null,
    faqQuestion: null,
    status: "ready",
    error: null,
    textOnly: false,
    pageCount: 120,
    chunkCount: 310,
    fetchedAt: null,
    refreshEnabled: false,
    refreshIntervalHours: null,
    nextRefreshAt: null,
    createdAt: new Date("2026-09-27T09:30:00Z"),
    updatedAt: new Date("2026-09-27T09:30:00Z"),
    ...overrides,
  };
}

describe("documents table", () => {
  it("a file: kind, file name under the title, pages, fragments, date and its link", () => {
    const [row] = toDocumentRows([doc({})], { kbId: "kb1", timezone: "Europe/Madrid", hint: "manage", now: NOW });
    expect(row).toMatchObject({
      href: "/conocimiento/kb1/documentos/d1",
      title: "Tarifas 2026",
      source: "Tarifas 2026.pdf",
      kindLabel: "PDF",
      status: { status: "ready", error: null, textOnly: false },
      mistralHint: null,
      pages: 120,
      chunks: 310,
      added: { relative: "hace 30 min", iso: "2026-09-27T09:30:00.000Z" },
    });
  });

  it("a web page shows its address unless it is already the title; a FAQ shows nothing under it", () => {
    const [page, pending, faq] = toDocumentRows(
      [
        doc({ sourceType: "url", title: "Servicios · Peluquería Ana", url: "https://ana.example/servicios", fileName: null, mimeType: null }),
        doc({ sourceType: "url", title: "https://ana.example/horario", url: "https://ana.example/horario", fileName: null, mimeType: null }),
        doc({ sourceType: "faq", title: "¿Abrís?", fileName: null, mimeType: null }),
      ],
      { kbId: "kb1", timezone: "Europe/Madrid", hint: "ask", now: NOW },
    );
    expect(page).toMatchObject({ source: "https://ana.example/servicios", kindLabel: "Página web" });
    expect(pending.source).toBeNull();
    expect(faq).toMatchObject({ source: null, kindLabel: "Pregunta frecuente" });
  });

  it("a scanned PDF without the Mistral OCR key says what to do; other errors do not [CON-07]", () => {
    const scanned = "PDF escaneado: añade la clave de Mistral OCR en Ajustes > IA para leerlo.";
    const rows = toDocumentRows(
      [doc({ status: "error", error: scanned }), doc({ id: "d2", status: "error", error: "No se ha podido leer el PDF. Puede estar protegido con contraseña o dañado." })],
      { kbId: "kb1", timezone: "Europe/Madrid", hint: "ask", now: NOW },
    );
    expect(rows.map((row) => row.mistralHint)).toEqual(["ask", null]);
  });

  it("only who can open Ajustes › IA gets the link to add the key [PER-04]", () => {
    expect(mistralKeyHintFor(actorFor("owner"))).toBe("manage");
    expect(mistralKeyHintFor(actorFor("admin"))).toBe("manage");
    expect(mistralKeyHintFor(actorFor("supervisor"))).toBe("ask");
    expect(mistralKeyHintFor(actorFor("viewer"))).toBe("ask");
  });
});
