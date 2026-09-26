// The guides of docs/ inside the app ([AJU-17]) and what the publication guide covers ([ARR-23]).
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findGuide, HELP_GUIDES, parseGuide, readGuide } from "./guides";

const DOCS = path.join(process.cwd(), "docs");
const GUIDE_FILE = /^(guia-.+|checklist-puesta-en-marcha)\.md$/;

describe("guides in Ayuda [AJU-17]", () => {
  it("every guide of docs/ is in the app, with exactly the text of its file", async () => {
    const files = fs.readdirSync(DOCS).filter((file) => GUIDE_FILE.test(file)).sort();
    expect(files.length).toBeGreaterThan(0);
    expect(HELP_GUIDES.map((guide) => guide.file).sort()).toEqual(files);
    for (const guide of HELP_GUIDES) {
      expect(await readGuide(guide), guide.file).toBe(fs.readFileSync(path.join(DOCS, guide.file), "utf8"));
    }
  });

  it("each guide has an address, a title and an index of its sections with unique anchors", async () => {
    for (const guide of HELP_GUIDES) {
      expect(guide.slug).toMatch(/^[a-z0-9-]+$/);
      expect(findGuide(guide.slug)).toBe(guide);
      const parsed = parseGuide(await readGuide(guide));
      expect(parsed.title.length, guide.file).toBeGreaterThan(0);
      expect(parsed.sections.length, guide.file).toBeGreaterThan(2);
      const ids = parsed.sections.map((section) => section.id);
      expect(new Set(ids).size).toBe(ids.length);
      // The page title is the guide's own; the content starts with its sections as second-level headings.
      expect(parsed.blocks.some((block) => block.type === "heading" && block.level === 1)).toBe(true);
    }
  });

  it("only the guides of the list exist: any other address, or a path trick, finds nothing", () => {
    for (const slug of ["no-existe", "../secretos", "..%2Fsecretos", "DESPLIEGUE", "", "despliegue/..", "security"]) {
      expect(findGuide(slug), slug).toBeNull();
    }
  });

  it("a guide's title and first section come from its text", () => {
    const parsed = parseGuide("# Mi guía\n\nIntro.\n\n## Primer paso\n\nTexto.\n\n### Detalle\n\n## Segundo paso");
    expect(parsed.title).toBe("Mi guía");
    expect(parsed.sections).toEqual([
      { id: "primer-paso", title: "Primer paso" },
      { id: "segundo-paso", title: "Segundo paso" },
    ]);
    expect(parsed.blocks.filter((block) => block.type === "heading").map((block) => block.type === "heading" && block.level)).toEqual([1, 2, 1]);
  });
});

describe("the publication guide [ARR-23]", () => {
  const guide = HELP_GUIDES.find((candidate) => candidate.file === "guia-despliegue.md");

  it("is in Spanish and covers Vercel with Turso, Blob and cron, and later the VPS, with room for screenshots", async () => {
    expect(guide).toBeDefined();
    const text = guide ? await readGuide(guide) : "";
    for (const topic of ["Vercel", "Turso", "Blob", "cron-job.org", "/api/cron/tick", "VPS", "SETUP_TOKEN", "libSQL", "Private"]) {
      expect(text, topic).toContain(topic);
    }
    expect(text.match(/\[Captura: /g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});
