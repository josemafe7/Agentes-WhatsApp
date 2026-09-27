// What the Conocimiento screens say about a base, a document and a search result (docs/pantallas.md «Conocimiento»).
import { describe, expect, it } from "vitest";
import { KB_DOCUMENT_STATUSES } from "@/lib/enums";
import {
  baseStateView,
  countLabel,
  checkFileBeforeUpload,
  documentKindLabel,
  documentStatusView,
  formatFileSize,
  isDocumentInProgress,
  KNOWLEDGE_FILE_ACCEPT,
  needsLiveRefresh,
  refreshIntervalLabel,
  reprocessActionLabel,
  searchResultScores,
} from "./labels";

describe("document status [CON-05]", () => {
  it("each step has its Spanish name, in order: en cola → extrayendo → troceando → embeddings → listo / error", () => {
    expect(KB_DOCUMENT_STATUSES.map((status) => documentStatusView({ status, error: null, textOnly: false }).label)).toEqual([
      "En cola",
      "Extrayendo",
      "Troceando",
      "Embeddings",
      "Listo",
      "Error",
    ]);
  });

  it("the steps in progress are marked as busy and ask for a live refresh; listo and error do not", () => {
    for (const status of ["queued", "extracting", "chunking", "embedding"] as const) {
      expect(isDocumentInProgress(status)).toBe(true);
      expect(documentStatusView({ status, error: null, textOnly: false }).busy).toBe(true);
    }
    for (const status of ["ready", "error"] as const) {
      expect(isDocumentInProgress(status)).toBe(false);
      expect(documentStatusView({ status, error: null, textOnly: false }).busy).toBe(false);
    }
    expect(needsLiveRefresh([{ status: "ready" }, { status: "error" }], false)).toBe(false);
    expect(needsLiveRefresh([{ status: "ready" }, { status: "chunking" }], false)).toBe(true);
    // A re-index builds a new index in the background: the page follows it too ([CON-13]).
    expect(needsLiveRefresh([{ status: "ready" }], true)).toBe(true);
    expect(needsLiveRefresh([], false)).toBe(false);
  });

  it("an error shows its reason; without one, a generic reason", () => {
    const scanned = "PDF escaneado: añade la clave de Mistral OCR en Ajustes > IA para leerlo.";
    expect(documentStatusView({ status: "error", error: scanned, textOnly: false })).toMatchObject({ label: "Error", tone: "error", detail: scanned });
    expect(documentStatusView({ status: "error", error: null, textOnly: false }).detail).toBe("No se ha podido procesar el documento.");
    // Only an error carries a reason.
    expect(documentStatusView({ status: "ready", error: "viejo", textOnly: false }).detail).toBeNull();
  });

  it("ready without embeddings yet reads «Listo (solo texto)»: it is found by words [CON-12]", () => {
    expect(documentStatusView({ status: "ready", error: null, textOnly: true })).toMatchObject({ label: "Listo (solo texto)", tone: "info", busy: false });
    expect(documentStatusView({ status: "ready", error: null, textOnly: false })).toMatchObject({ label: "Listo", tone: "success" });
  });
});

describe("what can be done again with a document [CON-05] [CON-09]", () => {
  it("retry after an error, refresh a web page, re-process a file or pasted text; nothing while a step runs", () => {
    expect(reprocessActionLabel("faq", "error")).toBe("Reintentar");
    expect(reprocessActionLabel("url", "ready")).toBe("Refrescar");
    expect(reprocessActionLabel("file", "ready")).toBe("Reprocesar");
    expect(reprocessActionLabel("text", "ready")).toBe("Reprocesar");
    expect(reprocessActionLabel("faq", "ready")).toBeNull();
    expect(reprocessActionLabel("url", "extracting")).toBeNull();
    expect(reprocessActionLabel("file", "queued")).toBeNull();
  });
});

describe("base state (docs/pantallas.md «Bases de conocimiento»)", () => {
  it("lista, indexando, reindexando, con errores o vacía", () => {
    expect(baseStateView("ready")).toEqual({ label: "Lista", tone: "success" });
    expect(baseStateView("processing")).toEqual({ label: "Indexando", tone: "info" });
    expect(baseStateView("reindexing")).toEqual({ label: "Reindexando", tone: "info" });
    expect(baseStateView("errors")).toEqual({ label: "Con errores", tone: "error" });
    expect(baseStateView("empty")).toEqual({ label: "Vacía", tone: "neutral" });
  });
});

describe("counts", () => {
  it("singular and plural, with Spanish thousands", () => {
    expect(countLabel(1, "documento", "documentos")).toBe("1 documento");
    expect(countLabel(0, "documento", "documentos")).toBe("0 documentos");
    expect(countLabel(12500, "fragmento", "fragmentos")).toBe("12.500 fragmentos");
  });
});

describe("what kind of document it is", () => {
  it("files by their type; web pages, FAQs and pasted text by their source", () => {
    expect(documentKindLabel({ sourceType: "file", mimeType: "application/pdf", fileName: "Tarifas.pdf" })).toBe("PDF");
    expect(
      documentKindLabel({ sourceType: "file", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", fileName: "a.docx" }),
    ).toBe("Word");
    expect(documentKindLabel({ sourceType: "file", mimeType: null, fileName: "precios.XLSX" })).toBe("Excel");
    expect(documentKindLabel({ sourceType: "file", mimeType: "text/csv", fileName: "stock.csv" })).toBe("CSV");
    expect(documentKindLabel({ sourceType: "file", mimeType: "text/markdown", fileName: "notas.md" })).toBe("Markdown");
    expect(documentKindLabel({ sourceType: "file", mimeType: "text/plain", fileName: "notas.txt" })).toBe("Texto");
    expect(documentKindLabel({ sourceType: "url", mimeType: null, fileName: null })).toBe("Página web");
    expect(documentKindLabel({ sourceType: "faq", mimeType: null, fileName: null })).toBe("Pregunta frecuente");
    expect(documentKindLabel({ sourceType: "text", mimeType: null, fileName: null })).toBe("Texto");
  });
});

describe("files chosen for upload are checked before sending [CON-04]", () => {
  const MB = 1024 * 1024;

  it("accepts PDF, DOCX, XLSX, CSV, TXT and MD, whatever the case of the extension", () => {
    for (const name of ["a.pdf", "b.DOCX", "c.xlsx", "d.csv", "e.txt", "f.md", "Tarifas 2026.PDF"]) expect(checkFileBeforeUpload({ name, size: 1_000 })).toBeNull();
    expect(KNOWLEDGE_FILE_ACCEPT).toBe(".pdf,.docx,.xlsx,.csv,.txt,.md");
  });

  it("refuses another type (old .xls with its own hint), an empty file and one over 25 MB", () => {
    expect(checkFileBeforeUpload({ name: "foto.jpg", size: 1_000 })).toBe("Ese tipo de archivo no se admite. Sube un PDF, DOCX, XLSX, CSV, TXT o MD.");
    expect(checkFileBeforeUpload({ name: "sin-extension", size: 1_000 })).toMatch(/no se admite/);
    expect(checkFileBeforeUpload({ name: "viejo.xls", size: 1_000 })).toMatch(/\.xls antiguos/);
    expect(checkFileBeforeUpload({ name: "vacio.txt", size: 0 })).toBe("El archivo está vacío.");
    expect(checkFileBeforeUpload({ name: "enorme.pdf", size: 25 * MB + 1 })).toBe("El archivo es demasiado grande. El máximo es 25 MB.");
    expect(checkFileBeforeUpload({ name: "justo.pdf", size: 25 * MB })).toBeNull();
  });

  it("sizes are shown in Spanish", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(340 * 1024)).toBe("340 KB");
    expect(formatFileSize(1.25 * MB)).toBe("1,3 MB");
    expect(formatFileSize(null)).toBe("—");
  });
});

describe("refresh of web pages [CON-09]", () => {
  it("names the usual intervals and any other in days", () => {
    expect(refreshIntervalLabel(24)).toBe("Cada día");
    expect(refreshIntervalLabel(168)).toBe("Cada semana");
    expect(refreshIntervalLabel(720)).toBe("Cada mes");
    expect(refreshIntervalLabel(72)).toBe("Cada 3 días");
    expect(refreshIntervalLabel(null)).toBe("Cada semana");
  });
});

describe("scores of «Probar búsqueda» [CON-21]", () => {
  it("fused score always; by meaning and by words only when the fragment came up that way", () => {
    expect(searchResultScores({ score: 0.032786, vectorScore: 0.81234, textRank: 3 }, false)).toEqual([
      { label: "Combinada", value: "0,0328" },
      { label: "Significado", value: "0,812" },
      { label: "Palabras", value: "n.º 3" },
    ]);
    expect(searchResultScores({ score: 0.016393, vectorScore: null, textRank: 1 }, false)).toEqual([
      { label: "Combinada", value: "0,0164" },
      { label: "Palabras", value: "n.º 1" },
    ]);
    // After «Reordenar resultados» the main score is the reranker's relevance.
    expect(searchResultScores({ score: 0.91, vectorScore: 0.7, textRank: null }, true)).toEqual([
      { label: "Reordenación", value: "0,910" },
      { label: "Significado", value: "0,700" },
    ]);
  });
});
