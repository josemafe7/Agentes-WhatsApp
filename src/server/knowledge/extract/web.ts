// Web pages of a knowledge base ([CON-04], [CON-09]): read through the SSRF-safe reader of src/server/web-fetch.ts
// (only public addresses, checked again at connect time and on every redirect), stored with the fetch date and a
// hash of the content so a refresh only re-processes what changed. A sitemap adds its pages, up to a cap.
import "server-only";
import { createHash } from "node:crypto";
import { SITEMAP_MAX_BYTES, SITEMAP_MAX_PAGES } from "../constants";
import { decodeText, fetchPublicPage, fetchPublicUrl, normalizeWebAddress, type ResolveHost, type WebTransport } from "@/server/web-fetch";
import { normalizeText } from "./text";

/** The web reader of the tests (a fake site and DNS); `webFetch`, not `fetchImpl`, so it never mixes with the AI's fetch. */
export type WebDeps = { webFetch?: WebTransport; resolveHost?: ResolveHost };

export type KnowledgePage = { url: string; title: string | null; markdown: string; contentHash: string };

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** The page as Markdown (main content only) with the SHA-256 of that Markdown ([CON-09]). */
export async function fetchKnowledgePage(url: string, deps: WebDeps = {}): Promise<KnowledgePage> {
  const page = await fetchPublicPage(url, { fetchImpl: deps.webFetch, resolveHost: deps.resolveHost });
  const markdown = normalizeText(page.markdown);
  return { url: page.url, title: page.title, markdown, contentHash: sha256Hex(markdown) };
}

const SITEMAP_TYPES = ["application/xml", "text/xml", "text/plain", "application/rss+xml", "application/atom+xml"] as const;
/** Child sitemaps followed from a sitemap index. */
const MAX_CHILD_SITEMAPS = 5;
/** Addresses read from one sitemap file: a few times the pages kept, since other sites and repeats are dropped. */
const CANDIDATES_PER_PAGE = 4;
const CDATA_OPEN = "<![CDATA[";
const CDATA_CLOSE = "]]>";

function decodeXmlEntities(text: string): string {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function sameSite(a: URL, b: URL): boolean {
  const host = (url: URL) => url.hostname.toLowerCase().replace(/^www\./, "");
  return host(a) === host(b);
}

/** The sitemap to read for what the person typed: the address itself if it ends in .xml, else /sitemap.xml of the site. */
export function sitemapAddressFor(input: string): string {
  const url = new URL(normalizeWebAddress(input));
  return url.pathname.toLowerCase().endsWith(".xml") ? url.href : new URL("/sitemap.xml", url).href;
}

/** The text of one <loc>: spaces and an optional CDATA wrapper out; null when it is empty or holds markup. */
function locValue(raw: string): string | null {
  let value = raw.trim();
  if (value.startsWith(CDATA_OPEN)) value = value.slice(CDATA_OPEN.length).trimStart();
  if (value.endsWith(CDATA_CLOSE)) value = value.slice(0, -CDATA_CLOSE.length).trimEnd();
  return value && !/[<\]]/.test(value) ? decodeXmlEntities(value) : null;
}

/**
 * The addresses of the <loc> elements of a sitemap, at most `limit`. A scan for the tags, never one pattern with
 * nested repetitions: the file comes from a site the business does not control and must not block the server, so
 * every character is looked at a bounded number of times whatever the file holds.
 */
export function sitemapLocs(xml: string, limit: number): string[] {
  const locs: string[] = [];
  const open = /<loc>/gi;
  const close = /<\/loc>/gi;
  let closeAt = -1;
  for (let found = open.exec(xml); found && locs.length < limit; found = open.exec(xml)) {
    const start = found.index + found[0].length;
    if (closeAt < start) {
      close.lastIndex = start;
      const end = close.exec(xml);
      // No closing tag after this one: none of the later ones has one either.
      if (!end) break;
      closeAt = end.index;
    }
    const value = locValue(xml.slice(start, closeAt));
    if (value) locs.push(value);
  }
  return locs;
}

async function readLocs(url: string, deps: WebDeps, limit: number): Promise<{ locs: string[]; isIndex: boolean }> {
  const response = await fetchPublicUrl(url, { accept: SITEMAP_TYPES, maxBytes: SITEMAP_MAX_BYTES, fetchImpl: deps.webFetch, resolveHost: deps.resolveHost });
  const xml = decodeText(response);
  return { locs: sitemapLocs(xml, limit), isIndex: /<sitemapindex[\s>]/i.test(xml) };
}

/**
 * Pages listed in a sitemap (one level of sitemap index followed), only http(s) pages of the same site, without
 * repeats, at most `maxPages`. The web decides which addresses appear: each one is checked again when read.
 */
export async function discoverSitemapPages(sitemapUrl: string, options: WebDeps & { maxPages?: number } = {}): Promise<string[]> {
  const maxPages = options.maxPages ?? SITEMAP_MAX_PAGES;
  const root = new URL(sitemapUrl);
  const found = new Set<string>();
  const add = (loc: string) => {
    try {
      const url = new URL(loc, root);
      if ((url.protocol === "http:" || url.protocol === "https:") && sameSite(url, root) && found.size < maxPages) {
        url.hash = "";
        found.add(url.href);
      }
    } catch {
      // Not an address: skipped.
    }
  };
  const limit = maxPages * CANDIDATES_PER_PAGE;
  const first = await readLocs(root.href, options, limit);
  if (!first.isIndex) {
    first.locs.forEach(add);
    return [...found];
  }
  for (const child of first.locs.slice(0, MAX_CHILD_SITEMAPS)) {
    if (found.size >= maxPages) break;
    let childUrl: URL;
    try {
      childUrl = new URL(child, root);
    } catch {
      continue;
    }
    if (!sameSite(childUrl, root)) continue;
    const { locs } = await readLocs(childUrl.href, options, limit);
    locs.forEach(add);
  }
  return [...found];
}
