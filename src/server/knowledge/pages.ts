// Pages inside the extracted Markdown ([CON-06]): a PDF is stored in kb_documents.content_md as one Markdown with a
// marker line before each page, so the chunks keep their page and a long OCR can go on where it stopped. The
// marker is an HTML comment: invisible if the Markdown is ever rendered.

export type PageText = { page: number | null; markdown: string };

const MARKER_LINE = /^<!-- página (\d+) -->$/;

export function pageMarker(page: number): string {
  return `<!-- página ${page} -->`;
}

/** One Markdown with a marker before each page (pages numbered from 1). */
export function joinPages(pages: readonly { page: number; markdown: string }[]): string {
  return pages.map(({ page, markdown }) => `${pageMarker(page)}\n${markdown.trim()}`).join("\n\n");
}

/** The pages of a Markdown with markers; without markers, one piece with page null. Empty pages are dropped. */
export function splitPages(markdown: string): PageText[] {
  const pieces: PageText[] = [];
  let current: PageText = { page: null, markdown: "" };
  const lines: string[] = [];
  const close = () => {
    const text = lines.join("\n").trim();
    if (text) pieces.push({ page: current.page, markdown: text });
    lines.length = 0;
  };
  for (const line of markdown.split(/\r?\n/)) {
    const marker = MARKER_LINE.exec(line.trim());
    if (marker) {
      close();
      current = { page: Number(marker[1]), markdown: "" };
      continue;
    }
    lines.push(line);
  }
  close();
  return pieces;
}

/** Highest page marker in the Markdown, 0 when there is none (how far a long OCR got). */
export function lastPageOf(markdown: string | null | undefined): number {
  let last = 0;
  for (const line of (markdown ?? "").split(/\r?\n/)) {
    const marker = MARKER_LINE.exec(line.trim());
    if (marker) last = Math.max(last, Number(marker[1]));
  }
  return last;
}
