import { describe, expect, it } from "vitest";
import { makePdf } from "@/server/media/test-fixtures";
import type { WebTransport } from "@/server/web-fetch";
import { KnowledgeProcessingError } from "../errors";
import { splitPages } from "../pages";
import { makeDocx, makeTextPdf, makeXlsx, makeZip } from "../test-helpers";
import {
  cleanDocumentTitle,
  cleanOcrMarkdown,
  defaultDocumentTitle,
  detectKnowledgeFile,
  discoverSitemapPages,
  docxTitle,
  extractFileToMarkdown,
  faqToMarkdown,
  fetchKnowledgePage,
  isDefaultDocumentTitle,
  isScannedPdf,
  readPdfPages,
  sitemapAddressFor,
  sitemapLocs,
} from "./index";
import { csvToMarkdown } from "./spreadsheet";
import { decodeTextFile } from "./text";
import { readZipEntry, zipUnpacksWithinLimits } from "./zip";

const utf8 = (text: string) => new TextEncoder().encode(text);

describe("accepted files [CON-04] [SEG-13]", () => {
  it("detects each kind by extension AND content", () => {
    expect(detectKnowledgeFile("tarifas.PDF", makePdf(["Hola"]))).toBe("pdf");
    expect(detectKnowledgeFile("manual.docx", makeDocx([{ text: "Hola" }]))).toBe("docx");
    expect(detectKnowledgeFile("precios.xlsx", makeXlsx("Hoja1", [["a"]]))).toBe("xlsx");
    expect(detectKnowledgeFile("precios.csv", utf8("a;b\n1;2"))).toBe("csv");
    expect(detectKnowledgeFile("notas.txt", utf8("hola"))).toBe("txt");
    expect(detectKnowledgeFile("notas.markdown", utf8("# Hola"))).toBe("md");
  });

  it("rejects other extensions, disguised files and empty ones", () => {
    expect(detectKnowledgeFile("foto.png", utf8("x"))).toBeNull();
    expect(detectKnowledgeFile("viejo.xls", utf8("x"))).toBeNull();
    // A text file renamed .pdf, a PDF renamed .docx, binary data renamed .txt.
    expect(detectKnowledgeFile("falso.pdf", utf8("no soy un pdf"))).toBeNull();
    expect(detectKnowledgeFile("falso.docx", makePdf(["x"]))).toBeNull();
    expect(detectKnowledgeFile("binario.txt", new Uint8Array([0x68, 0x00, 0x6f]))).toBeNull();
    expect(detectKnowledgeFile("vacio.txt", new Uint8Array())).toBeNull();
  });
});

describe("PDF with pages [CON-06] [CON-07]", () => {
  it("keeps the text of each page and its number", async () => {
    const pdf = makePdf([
      "Tarifas de peluqueria para 2026 con todos los servicios del salon y sus condiciones",
      "Corte de pelo 25 euros y tinte completo 40 euros; mechas desde 55 euros segun largo",
    ]);
    const text = await readPdfPages(pdf);
    expect(text.pageCount).toBe(2);
    expect(text.pages[1]).toContain("Corte de pelo 25 euros");
    const { markdown, pageCount } = await extractFileToMarkdown("pdf", pdf);
    expect(pageCount).toBe(2);
    expect(splitPages(markdown)).toEqual([
      { page: 1, markdown: expect.stringContaining("Tarifas de peluqueria") },
      { page: 2, markdown: expect.stringContaining("tinte completo 40 euros") },
    ]);
  });

  it("a PDF without text is a scan: without a Mistral key it stays with the warning", async () => {
    const scan = makePdf(["", "", ""]);
    expect(isScannedPdf(await readPdfPages(scan))).toBe(true);
    await expect(extractFileToMarkdown("pdf", scan)).rejects.toThrow("PDF escaneado: añade la clave de Mistral OCR en Ajustes > IA para leerlo.");
  });

  it("a damaged PDF is a clear error, not a crash", async () => {
    const broken = utf8("%PDF-1.4\nesto no es un pdf de verdad");
    await expect(readPdfPages(broken)).rejects.toBeInstanceOf(KnowledgeProcessingError);
  });

  it("OCR Markdown loses the image markers", () => {
    expect(cleanOcrMarkdown("# Tarifas\n\n![img-0.jpeg](img-0.jpeg)\n\n| A | B |\n|---|---|\n| 1 | 2 |")).toBe("# Tarifas\n\n| A | B |\n|---|---|\n| 1 | 2 |");
  });
});

describe("DOCX to Markdown keeps headings and tables [CON-06] [CON-10]", () => {
  it("headings become Markdown headings and a Word table a Markdown table", async () => {
    const docx = makeDocx([
      { heading: 1, text: "Manual de la clínica" },
      { text: "Abrimos de lunes a viernes." },
      { heading: 2, text: "Precios" },
      { table: [["Tratamiento", "Precio"], ["Limpieza", "50 €"], ["Empaste | simple", "60 €"]] },
    ]);
    const { markdown } = await extractFileToMarkdown("docx", docx);
    expect(markdown).toContain("# Manual de la clínica");
    expect(markdown).toContain("## Precios");
    expect(markdown).toContain("Abrimos de lunes a viernes.");
    expect(markdown).toContain("| Tratamiento | Precio |");
    expect(markdown).toContain("| Limpieza | 50 € |");
    expect(markdown).toContain("| Empaste \\| simple | 60 € |");
  });

  it("a Word or Excel file that unpacks to too much is refused before it is read (zip bomb) [SEG-13]", async () => {
    const MB = 1024 * 1024;
    const bomb = makeZip({ "word/document.xml": "0".repeat(2 * MB) });
    expect(bomb.length).toBeLessThan(50_000);
    expect(zipUnpacksWithinLimits(bomb, { maxUnpackedBytes: MB, maxEntries: 10 })).toBe(false);
    expect(zipUnpacksWithinLimits(bomb, { maxUnpackedBytes: 3 * MB, maxEntries: 10 })).toBe(true);
    // The sizes the archive declares are not trusted: one that says «10 bytes» is still measured for real.
    const lying = Buffer.from(bomb);
    const central = lying.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    lying.writeUInt32LE(10, central + 24);
    expect(zipUnpacksWithinLimits(new Uint8Array(lying), { maxUnpackedBytes: MB, maxEntries: 10 })).toBe(false);
    expect(zipUnpacksWithinLimits(makeZip({ a: "a", b: "b", c: "c" }), { maxUnpackedBytes: MB, maxEntries: 2 })).toBe(false);
    expect(zipUnpacksWithinLimits(makeDocx([{ heading: 1, text: "Tarifas" }]))).toBe(true);
    expect(zipUnpacksWithinLimits(utf8("PK\u0003\u0004 no es un zip"))).toBe(false);
    // What is refused never reaches the readers: the usual «No se ha podido leer…».
    const unsupported = Buffer.from(makeDocx([{ text: "Hola" }]));
    unsupported.writeUInt16LE(99, unsupported.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 10);
    await expect(extractFileToMarkdown("docx", new Uint8Array(unsupported))).rejects.toThrow("No se ha podido leer el documento de Word");
    await expect(extractFileToMarkdown("xlsx", new Uint8Array(unsupported))).rejects.toThrow("No se ha podido leer la hoja de cálculo");
  });

  it("a damaged DOCX is a clear error", async () => {
    await expect(extractFileToMarkdown("docx", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))).rejects.toBeInstanceOf(KnowledgeProcessingError);
  });
});

describe("the document's own title, from its metadata [CON-10]", () => {
  const lines = ["Tarifas de peluqueria para 2026 con todos los servicios del salon y sus condiciones de reserva"];

  it("a PDF's title (its information dictionary) comes with its text; without one, none", async () => {
    const titled = makeTextPdf([lines], { title: "Tarifas y servicios · 2026" });
    expect((await readPdfPages(titled)).title).toBe("Tarifas y servicios · 2026");
    expect(await extractFileToMarkdown("pdf", titled)).toMatchObject({ title: "Tarifas y servicios · 2026", pageCount: 1 });
    expect((await readPdfPages(makeTextPdf([lines]))).title).toBeNull();
    expect((await extractFileToMarkdown("pdf", makeTextPdf([lines]))).title).toBeNull();
  });

  it("a Word document's title (docProps/core.xml) comes with its text; without one, none", async () => {
    const titled = makeDocx([{ heading: 1, text: "Manual" }, { text: "Abrimos de lunes a viernes." }], { title: "Manual de la clínica & protocolo" });
    expect(docxTitle(titled)).toBe("Manual de la clínica & protocolo");
    expect(await extractFileToMarkdown("docx", titled)).toMatchObject({ title: "Manual de la clínica & protocolo" });
    expect((await extractFileToMarkdown("docx", makeDocx([{ text: "Abrimos de lunes a viernes." }]))).title).toBeNull();
    // Other files have no title of their own.
    expect((await extractFileToMarkdown("txt", utf8("Abrimos de lunes a viernes."))).title).toBeNull();
  });

  it("a title that says nothing, or is only a file name, is not a title", () => {
    expect(cleanDocumentTitle("  Tarifas\u0000 de\n\t2026  ")).toBe("Tarifas de 2026");
    expect(cleanDocumentTitle("x".repeat(400))).toHaveLength(300);
    for (const empty of [null, undefined, "", "   ", "Untitled", "sin título", "Documento1", "Microsoft Word - tarifas.docx", "presupuesto.pdf"]) {
      expect(cleanDocumentTitle(empty)).toBeNull();
    }
  });

  it("the title a file gets from its name is the one its metadata may replace; a title someone wrote is not", () => {
    expect(defaultDocumentTitle("Tarifas 2026.pdf")).toBe("Tarifas 2026");
    expect(defaultDocumentTitle(".pdf")).toBe(".pdf");
    expect(isDefaultDocumentTitle("Tarifas 2026", "Tarifas 2026.pdf")).toBe(true);
    expect(isDefaultDocumentTitle("Tarifas 2026.pdf", "Tarifas 2026.pdf")).toBe(true);
    expect(isDefaultDocumentTitle("Precios del salón", "Tarifas 2026.pdf")).toBe(false);
    expect(isDefaultDocumentTitle("Precios", null)).toBe(false);
  });

  it("the metadata of a Word file is read with a cap, never trusting the sizes it declares [SEG-13]", () => {
    const docx = makeDocx([{ text: "Hola" }], { title: "Manual" });
    expect(new TextDecoder().decode(readZipEntry(docx, "docProps/core.xml", 64 * 1024) ?? new Uint8Array())).toContain("<dc:title>Manual</dc:title>");
    expect(readZipEntry(docx, "docProps/core.xml", 10)).toBeNull();
    expect(readZipEntry(docx, "no/existe.xml", 64 * 1024)).toBeNull();
    const bomb = makeZip({ "docProps/core.xml": `<dc:title>${"0".repeat(2 * 1024 * 1024)}</dc:title>` });
    expect(readZipEntry(bomb, "docProps/core.xml", 64 * 1024)).toBeNull();
    expect(docxTitle(bomb)).toBeNull();
    // A hostile title never makes the reader slow.
    const hostile = makeZip({ "docProps/core.xml": `<dc:title>${"&amp;".repeat(5_000)}${"<".repeat(5_000)}` });
    const started = performance.now();
    expect(docxTitle(hostile)).toBeNull();
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe("spreadsheets in blocks of about 20 rows with the header repeated [CON-08]", () => {
  const header = ["Servicio", "Precio"];
  const rows = Array.from({ length: 45 }, (_, index) => [`Servicio ${index + 1}`, `${10 + index} €`]);

  function tables(markdown: string): string[][] {
    return markdown
      .split(/\n{2,}/)
      .filter((block) => block.startsWith("|"))
      .map((block) => block.split("\n"));
  }

  it("CSV (with ; separator and quoted fields)", () => {
    const csv = [header.join(";"), ...rows.map((row) => row.join(";")), '"Corte; con lavado";"25 €"'].join("\n");
    const markdown = csvToMarkdown(utf8(csv));
    const blocks = tables(markdown);
    expect(blocks).toHaveLength(3);
    for (const block of blocks) {
      expect(block[0]).toBe("| Servicio | Precio |");
      expect(block[1]).toBe("| --- | --- |");
    }
    expect(blocks.map((block) => block.length - 2)).toEqual([20, 20, 6]);
    expect(markdown).toContain("### Filas 1–20");
    expect(markdown).toContain("| Corte; con lavado | 25 € |");
  });

  it("XLSX", async () => {
    const { markdown } = await extractFileToMarkdown("xlsx", makeXlsx("Tarifas", [header, ...rows.map(([name], index) => [name, 10 + index])]));
    const blocks = tables(markdown);
    expect(blocks.map((block) => block.length - 2)).toEqual([20, 20, 5]);
    expect(blocks.every((block) => block[0] === "| Servicio | Precio |")).toBe(true);
    expect(markdown).toContain("| Servicio 45 | 54 |");
  });
});

describe("text, Markdown and FAQs", () => {
  it("UTF-8 with BOM, Windows line ends and Windows-1252 files", () => {
    expect(decodeTextFile(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("Línea 1\r\nLínea 2")]))).toBe("Línea 1\nLínea 2");
    // «Cañón» in Windows-1252.
    expect(decodeTextFile(new Uint8Array([0x43, 0x61, 0xf1, 0xf3, 0x6e]))).toBe("Cañón");
  });

  it("spaces at line ends go, and a hostile file (a long run of spaces, broken image links) never blocks the server", () => {
    expect(decodeTextFile(utf8("Línea 1 \t \nLínea 2  \n\n\n\nFin"))).toBe("Línea 1\nLínea 2\n\nFin");
    // The old patterns took about half a second for 40,000 spaces and grew with the square: these took hours.
    const hostile = [`texto${" ".repeat(2_000_000)}x`, `texto${" \t".repeat(1_000_000)}\nfin`];
    for (const text of hostile) {
      const started = performance.now();
      decodeTextFile(utf8(text));
      expect(performance.now() - started).toBeLessThan(1_000);
    }
    const started = performance.now();
    cleanOcrMarkdown(`${"![a](".repeat(400_000)}\n${"[img-1.png](".repeat(200_000)}`);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("a FAQ is a small document with the question as its heading", () => {
    expect(faqToMarkdown("¿Aceptáis tarjeta?\n", "Sí, todas.")).toBe("## ¿Aceptáis tarjeta?\n\nSí, todas.");
  });

  it("a file without any text is refused", async () => {
    await expect(extractFileToMarkdown("txt", utf8("   \n "))).rejects.toThrow("No se ha encontrado texto");
  });
});

describe("web pages and sitemaps [CON-04] [CON-09]", () => {
  const publicDns = async () => [{ address: "93.184.216.34", family: 4 }];

  function site(pages: Record<string, { type: string; body: string }>): WebTransport {
    return async (url) => {
      const page = pages[url];
      if (!page) return new Response("no", { status: 404, headers: { "content-type": "text/plain" } });
      return new Response(page.body, { status: 200, headers: { "content-type": page.type } });
    };
  }

  it("a page becomes Markdown with a hash of its content", async () => {
    const html = "<html><head><title>Peluquería Ana</title></head><body><nav>Menú</nav><article><h1>Servicios</h1><p>Cortamos el pelo desde 1990 en el centro de la ciudad, con los mejores productos y un equipo de profesionales.</p><p>Pide tu cita por teléfono o por WhatsApp.</p></article></body></html>";
    const webFetch = site({ "https://ana.example/servicios": { type: "text/html; charset=utf-8", body: html } });
    const page = await fetchKnowledgePage("https://ana.example/servicios", { webFetch, resolveHost: publicDns });
    expect(page.markdown).toContain("Cortamos el pelo desde 1990");
    expect(page.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const again = await fetchKnowledgePage("https://ana.example/servicios", { webFetch, resolveHost: publicDns });
    expect(again.contentHash).toBe(page.contentHash);
  });

  it("an internal address is never read (SSRF)", async () => {
    const webFetch = site({});
    await expect(fetchKnowledgePage("http://127.0.0.1/admin", { webFetch })).rejects.toThrow("no es una web pública");
    await expect(fetchKnowledgePage("https://intranet.example/", { webFetch, resolveHost: async () => [{ address: "10.0.0.5", family: 4 }] })).rejects.toThrow(
      "no es una web pública",
    );
  });

  it("the sitemap gives the site's pages, without other sites, repeats or more than the cap", async () => {
    const xml = `<?xml version="1.0"?><urlset>
      <url><loc>https://ana.example/</loc></url>
      <url><loc> https://ana.example/precios?a=1&amp;b=2 </loc></url>
      <url><loc>https://www.ana.example/contacto</loc></url>
      <url><loc>https://otro.example/spam</loc></url>
      <url><loc>https://ana.example/</loc></url>
      <url><loc>javascript:alert(1)</loc></url>
    </urlset>`;
    const webFetch = site({ "https://ana.example/sitemap.xml": { type: "application/xml", body: xml } });
    expect(sitemapAddressFor("ana.example")).toBe("https://ana.example/sitemap.xml");
    expect(sitemapAddressFor("https://ana.example/mapa.xml")).toBe("https://ana.example/mapa.xml");
    const pages = await discoverSitemapPages("https://ana.example/sitemap.xml", { webFetch, resolveHost: publicDns });
    expect(pages).toEqual(["https://ana.example/", "https://ana.example/precios?a=1&b=2", "https://www.ana.example/contacto"]);
    expect(await discoverSitemapPages("https://ana.example/sitemap.xml", { webFetch, resolveHost: publicDns, maxPages: 1 })).toEqual(["https://ana.example/"]);
  });

  it("reads <loc> with CDATA and spaces, skips markup inside, and stops at the limit", () => {
    const xml = [
      "<urlset>",
      "<url><LOC>\n  https://ana.example/a  \n</LOC></url>",
      "<url><loc><![CDATA[ https://ana.example/b?x=1&y=2 ]]></loc></url>",
      "<url><loc>https://ana.example/<b>c</b></loc></url>",
      "<url><loc>   </loc></url>",
      "<url><loc>https://ana.example/d</loc></url>",
      "</urlset>",
    ].join("");
    expect(sitemapLocs(xml, 10)).toEqual(["https://ana.example/a", "https://ana.example/b?x=1&y=2", "https://ana.example/d"]);
    expect(sitemapLocs(xml, 2)).toEqual(["https://ana.example/a", "https://ana.example/b?x=1&y=2"]);
  });

  it("a hostile sitemap never blocks the server: the time grows with the size, not faster", () => {
    // With the old pattern (nested repetitions over the spaces) 400 spaces took 90 s and this would take hours.
    const hostile = [`<loc>${" ".repeat(50_000)}x`, `${"<loc>".repeat(20_000)}x`, `${"<loc> </loc>".repeat(20_000)}`];
    for (const xml of hostile) {
      const started = performance.now();
      sitemapLocs(xml, 200);
      expect(performance.now() - started).toBeLessThan(100);
    }
  });

  it("follows one level of sitemap index", async () => {
    const webFetch = site({
      "https://ana.example/sitemap.xml": { type: "text/xml", body: "<sitemapindex><sitemap><loc>https://ana.example/paginas.xml</loc></sitemap></sitemapindex>" },
      "https://ana.example/paginas.xml": { type: "text/xml", body: "<urlset><url><loc>https://ana.example/equipo</loc></url></urlset>" },
    });
    expect(await discoverSitemapPages("https://ana.example/sitemap.xml", { webFetch, resolveHost: publicDns })).toEqual(["https://ana.example/equipo"]);
  });
});
