import { describe, expect, it } from "vitest";
import { extractPdfText } from "./pdf";
import { makePdf } from "./test-fixtures";

describe("text of a PDF for models that cannot open it [MED-06]", () => {
  it("reads the text of every page", async () => {
    const text = await extractPdfText(makePdf(["Presupuesto de boda", "Total: 450 euros"]));
    expect(text).toContain("Presupuesto de boda");
    expect(text).toContain("Total: 450 euros");
  });

  it("keeps only the first pages and characters, and says the document goes on", async () => {
    const pages = Array.from({ length: 5 }, (_, index) => `Pagina ${index + 1} ${"x".repeat(40)}`);
    const byPages = await extractPdfText(makePdf(pages), { maxPages: 2, maxChars: 10_000 });
    expect(byPages).toContain("Pagina 2");
    expect(byPages).not.toContain("Pagina 3");
    expect(byPages).toMatch(/el documento sigue/);
    const byChars = await extractPdfText(makePdf(pages), { maxPages: 50, maxChars: 30 });
    expect(byChars?.split("\n")[0].length).toBeLessThanOrEqual(30);
    expect(byChars).toMatch(/el documento sigue/);
  });

  it("a file that is not a PDF, or a PDF without text, gives nothing (never an error)", async () => {
    expect(await extractPdfText(new TextEncoder().encode("esto no es un pdf"))).toBeNull();
    expect(await extractPdfText(makePdf(["   "]))).toBeNull();
  });
});
