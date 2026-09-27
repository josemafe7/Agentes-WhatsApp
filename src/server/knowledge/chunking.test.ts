import { describe, expect, it } from "vitest";
import { chunkMarkdown, chunkPrefix, embeddingInput, parseHeading } from "./chunking";
import { CHUNK_MAX_TOKENS, CHUNK_MIN_TOKENS } from "./constants";
import { sheetToMarkdown } from "./extract/tables";
import { joinPages, lastPageOf, splitPages } from "./pages";
import { estimateTokens } from "./tokens";

/** A Spanish sentence of about 25 tokens, numbered so every one is different. */
const sentence = (n: number) => `La frase número ${n} explica con calma un detalle del servicio de la peluquería y sus condiciones.`;
const paragraph = (from: number, count: number) => Array.from({ length: count }, (_, index) => sentence(from + index)).join(" ");

describe("token estimate (docs/busqueda-hibrida.md §6)", () => {
  it("is characters / 3.5 rounded up, and 0 for nothing", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("   ")).toBe(0);
    expect(estimateTokens("abcdefg")).toBe(2);
    expect(estimateTokens("a".repeat(350))).toBe(100);
  });
});

describe("page markers [CON-06]", () => {
  it("join and split keep the page numbers and skip empty pages", () => {
    const markdown = joinPages([
      { page: 1, markdown: "Uno" },
      { page: 2, markdown: "" },
      { page: 3, markdown: "Tres" },
    ]);
    expect(splitPages(markdown)).toEqual([
      { page: 1, markdown: "Uno" },
      { page: 3, markdown: "Tres" },
    ]);
    expect(lastPageOf(markdown)).toBe(3);
    expect(splitPages("Sin páginas")).toEqual([{ page: null, markdown: "Sin páginas" }]);
  });
});

describe("chunking [CON-10]", () => {
  it("cuts by headings: each section its own chunk with its heading path", () => {
    const markdown = [
      "# Guía del salón",
      "## Precios",
      paragraph(1, 8),
      "### Cortes",
      paragraph(20, 8),
      "## Horario",
      paragraph(40, 8),
    ].join("\n\n");
    const chunks = chunkMarkdown(markdown);
    expect(chunks.map((chunk) => chunk.section)).toEqual(["Guía del salón > Precios", "Guía del salón > Precios > Cortes", "Guía del salón > Horario"]);
    expect(chunks[0].content.startsWith("# Guía del salón\n\n## Precios")).toBe(true);
    expect(chunks[1].content.startsWith("### Cortes")).toBe(true);
    expect(chunks.map((chunk) => chunk.ord)).toEqual([0, 1, 2]);
  });

  it("keeps chunks around 400 tokens (never above 600, not below 150 except a short document) with overlap", () => {
    const chunks = chunkMarkdown(["## Condiciones", paragraph(1, 60)].join("\n\n"));
    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(CHUNK_MAX_TOKENS);
      expect(chunk.tokenCount).toBeGreaterThanOrEqual(CHUNK_MIN_TOKENS);
      expect(chunk.section).toBe("Condiciones");
    }
    // About 60 tokens of the end of each chunk start the next one.
    for (let index = 1; index < chunks.length; index += 1) {
      const lastSentence = chunks[index - 1].content.split(/(?<=\.)\s+/).at(-1) ?? "";
      expect(chunks[index].content.startsWith(lastSentence.slice(0, 20)) || chunks[index].content.includes(lastSentence)).toBe(true);
    }
    // Nothing of the text is lost.
    const all = chunks.map((chunk) => chunk.content).join(" ");
    for (let n = 1; n <= 60; n += 1) expect(all).toContain(`La frase número ${n} `);
  });

  it("a short document is one chunk, even under the minimum", () => {
    expect(chunkMarkdown("## ¿Aceptáis tarjeta?\n\nSí, todas.")).toEqual([
      { ord: 0, section: "¿Aceptáis tarjeta?", page: null, content: "## ¿Aceptáis tarjeta?\n\nSí, todas.", tokenCount: estimateTokens("## ¿Aceptáis tarjeta?\n\nSí, todas.") },
    ]);
  });

  it("never splits a table row, and a long table repeats its header in every piece [CON-08]", () => {
    const rows = Array.from({ length: 120 }, (_, index) => [`Servicio especial de peluquería número ${index + 1}`, `${10 + index},00 €`, "Incluye lavado y peinado"]);
    const table = sheetToMarkdown([["Servicio", "Precio", "Notas"], ...rows], { blockRows: 200 });
    const chunks = chunkMarkdown(`## Tarifas\n\n${table}`);
    expect(chunks.length).toBeGreaterThan(2);
    const seen: string[] = [];
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(CHUNK_MAX_TOKENS);
      const lines = chunk.content.split("\n").filter((line) => line.startsWith("|"));
      expect(lines[0]).toBe("| Servicio | Precio | Notas |");
      expect(lines[1]).toBe("| --- | --- | --- |");
      for (const line of lines.slice(2)) {
        expect(line).toMatch(/^\| Servicio especial de peluquería número \d+ \| \d+,00 € \| Incluye lavado y peinado \|$/);
        seen.push(line);
      }
    }
    expect(seen).toHaveLength(120);
  });

  it("keeps the page where each chunk starts and starts a new chunk on a new page when big enough [CON-23]", () => {
    const markdown = joinPages([
      { page: 1, markdown: paragraph(1, 10) },
      { page: 2, markdown: paragraph(20, 10) },
      { page: 3, markdown: "Una línea corta." },
    ]);
    const chunks = chunkMarkdown(markdown);
    expect(chunks.map((chunk) => chunk.page)).toEqual([1, 2]);
    expect(chunks[0].content).toContain("La frase número 1 ");
    expect(chunks[1].content).toContain("La frase número 20 ");
    // The short last page joins the previous chunk of the same section, marked with its page.
    expect(chunks[1].content).toContain("[pág. 3]\n\nUna línea corta.");
    expect(chunks.some((chunk) => chunk.content.includes("<!--"))).toBe(false);
  });

  it("short pages share a chunk, each marked «[pág. N]» where it starts [CON-23]", () => {
    const markdown = joinPages([1, 2, 3].map((page) => ({ page, markdown: `Texto breve de la página ${page}.` })));
    expect(chunkMarkdown(markdown)).toEqual([
      expect.objectContaining({
        page: 1,
        content: "Texto breve de la página 1.\n\n[pág. 2]\n\nTexto breve de la página 2.\n\n[pág. 3]\n\nTexto breve de la página 3.",
      }),
    ]);
  });

  it("a paragraph without full stops is cut at spaces, never above the maximum", () => {
    const words = Array.from({ length: 900 }, (_, index) => `palabra${index}`).join(" ");
    const chunks = chunkMarkdown(words);
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) expect(chunk.tokenCount).toBeLessThanOrEqual(CHUNK_MAX_TOKENS);
    expect(chunks.map((chunk) => chunk.content).join(" ")).toContain("palabra899");
  });

  it("gives the same chunks for the same Markdown, and none for an empty one", () => {
    const markdown = ["# A", paragraph(1, 30)].join("\n\n");
    expect(chunkMarkdown(markdown)).toEqual(chunkMarkdown(markdown));
    expect(chunkMarkdown("   \n\n")).toEqual([]);
  });
});

describe("prefix and text for the embeddings [CON-10] (docs/busqueda-hibrida.md §7)", () => {
  it("«Documento: título > sección» and the two-sentence summary before the chunk", () => {
    expect(chunkPrefix("Tarifas 2026", "Precios > Cortes")).toBe("Documento: Tarifas 2026 > Precios > Cortes");
    expect(chunkPrefix("Tarifas 2026", null)).toBe("Documento: Tarifas 2026");
    expect(embeddingInput({ title: "Tarifas", section: "Cortes", summary: "Precios del salón.\nPara 2026.", content: "Corte: 25 €\r\n" })).toBe(
      "Documento: Tarifas > Cortes\nResumen: Precios del salón. Para 2026.\n\nCorte: 25 €",
    );
    expect(embeddingInput({ title: "Tarifas", section: null, content: "Corte" })).toBe("Documento: Tarifas\n\nCorte");
  });

  it("is NFC, so the same words always give the same text", () => {
    const decomposed = "Depilación";
    expect(embeddingInput({ title: decomposed, section: null, content: decomposed })).toBe(embeddingInput({ title: "Depilación", section: null, content: "Depilación" }));
  });
});

describe("headings of any text, without blocking the server (external content is data)", () => {
  /** The pattern headings were read with before: same results, but its time grew with the cube of a line's spaces. */
  const OLD_HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
  const oldHeading = (line: string) => {
    const match = OLD_HEADING.exec(line);
    return match ? { level: match[1].length, text: match[2].trim() } : null;
  };

  it("reads the same headings as before, trailing «#» and spaces out", () => {
    expect(parseHeading("## Precios ##")).toEqual({ level: 2, text: "Precios" });
    expect(parseHeading("# Guía del salón")).toEqual({ level: 1, text: "Guía del salón" });
    expect(parseHeading("###### Seis")).toEqual({ level: 6, text: "Seis" });
    expect(parseHeading("####### Siete")).toBeNull();
    expect(parseHeading("#sinespacio")).toBeNull();
    expect(parseHeading("Texto # no")).toBeNull();
    // Every short line made of the characters that matter, compared with the old pattern.
    const alphabet = ["#", " ", "\t", "\u00a0", "a", "b", "\r", "\u2028"];
    let seed = 7;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    for (let n = 0; n < 20_000; n += 1) {
      const length = 1 + Math.floor(random() * 10);
      const line = Array.from({ length }, () => alphabet[Math.floor(random() * alphabet.length)]).join("");
      expect(parseHeading(line), JSON.stringify(line)).toEqual(oldHeading(line));
    }
  });

  it("a heading line full of spaces (or &nbsp; from a web page) takes the same time as any line", () => {
    // With the old pattern 4,000 spaces took 6 s: these would have taken days.
    const lines = [`# a${" ".repeat(100_000)}b`, `# a${"\u00a0".repeat(100_000)}b`, `## ${"# ".repeat(50_000)}x`, `# ${" ".repeat(100_000)}`];
    for (const line of lines) {
      const started = performance.now();
      parseHeading(line);
      chunkMarkdown(`${line}\n\nTexto.`);
      expect(performance.now() - started).toBeLessThan(500);
    }
  });
});
