// Pages of a long list shown on the server (DESIGN.md «Tablas y listas»: 25 per page): the fragments of a document,
// and the documents and FAQs of a base. The page comes from the URL (`?pagina=2`), so anything typed there is read
// defensively.

export const LIST_PAGE_SIZE = 25;
export const FRAGMENTS_PER_PAGE = LIST_PAGE_SIZE;
export const PAGE_PARAM = "pagina";

export type PageSlice = { page: number; pages: number; start: number; end: number };

/** The page asked for (1 when missing or not a number; the last one when past the end) and its range. */
export function pageSlice(requested: string | string[] | undefined, total: number, perPage = LIST_PAGE_SIZE): PageSlice {
  const pages = Math.max(1, Math.ceil(total / perPage));
  const raw = Array.isArray(requested) ? requested[0] : requested;
  const asked = raw && /^\d{1,6}$/.test(raw) ? Number(raw) : 1;
  const page = Math.min(Math.max(asked, 1), pages);
  const start = (page - 1) * perPage;
  return { page, pages, start, end: Math.min(start + perPage, total) };
}

/** The address of page `page` of the list at `path` (the first one without ?pagina=). */
export function pageHref(path: string, page: number): string {
  return page > 1 ? `${path}?${PAGE_PARAM}=${page}` : path;
}
