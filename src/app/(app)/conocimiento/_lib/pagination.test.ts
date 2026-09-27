// Long lists of the knowledge (fragments of a document, documents and FAQs of a base) are shown 25 per page, with the
// page in the URL (DESIGN.md «Tablas y listas»).
import { describe, expect, it } from "vitest";
import { LIST_PAGE_SIZE, pageHref, pageSlice } from "./pagination";

describe("pages of fragments", () => {
  it("25 per page; the page from ?pagina=", () => {
    expect(pageSlice(undefined, 60)).toEqual({ page: 1, pages: 3, start: 0, end: 25 });
    expect(pageSlice("2", 60)).toEqual({ page: 2, pages: 3, start: 25, end: 50 });
    expect(pageSlice("3", 60)).toEqual({ page: 3, pages: 3, start: 50, end: 60 });
  });

  it("anything else typed in the address falls back to a valid page", () => {
    expect(pageSlice("99", 60).page).toBe(3);
    expect(pageSlice("0", 60).page).toBe(1);
    expect(pageSlice("-1", 60).page).toBe(1);
    expect(pageSlice("dos", 60).page).toBe(1);
    expect(pageSlice(["2", "3"], 60).page).toBe(2);
    expect(pageSlice("1e9", 60).page).toBe(1);
  });

  it("an empty list is one empty page", () => {
    expect(pageSlice("4", 0)).toEqual({ page: 1, pages: 1, start: 0, end: 0 });
  });
});

describe("pages of documents and FAQs of a base", () => {
  it("25 per page too (a sitemap adds 50 pages at once), with ?pagina= from the second one", () => {
    expect(LIST_PAGE_SIZE).toBe(25);
    expect(pageSlice("2", 51, LIST_PAGE_SIZE)).toEqual({ page: 2, pages: 3, start: 25, end: 50 });
    expect(pageHref("/conocimiento/kb-1", 1)).toBe("/conocimiento/kb-1");
    expect(pageHref("/conocimiento/kb-1/faq", 3)).toBe("/conocimiento/kb-1/faq?pagina=3");
  });
});
