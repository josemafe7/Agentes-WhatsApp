// Guides of Ayuda ([AJU-17], [ARR-23]): the docs/guia-*.md files (and, from phase 7, the start-up checklist). They
// are read on the server from docs/, and next.config.ts adds those files to the output of the /ayuda pages when the
// app is compiled (outputFileTracingIncludes), so a published app carries them without the repository.
// Each phase adds its guide here; a test checks that none of docs/ is missing.
import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { headingAnchors, inlineText, parseMarkdown, type Block } from "@/lib/markdown";

export type HelpGuide = {
  /** Address: /ayuda/<slug>. */
  slug: string;
  /** File in docs/. */
  file: string;
  /** One line for the list of guides. */
  description: string;
};

export const HELP_GUIDES: readonly HelpGuide[] = [
  {
    slug: "agenda",
    file: "guia-agenda.md",
    description: "Preparar la agenda del negocio: palabras, servicios, recursos, horarios, ausencias, modo por recurso o por aforo, recordatorios y qué hace el agente con las citas.",
  },
  {
    slug: "agentes-y-conocimiento",
    file: "guia-agentes-y-conocimiento.md",
    description: "Crear un agente desde la plantilla de tu sector, darle el conocimiento del negocio (archivos y bases), probarlo y ver de dónde saca cada respuesta.",
  },
  {
    slug: "correo",
    file: "guia-correo.md",
    description: "Conectar un buzón de Gmail (Google Cloud), Outlook o Microsoft 365 (Microsoft Entra) u otro servidor IMAP/SMTP: paso a paso, modos de respuesta, filtros y problemas.",
  },
  {
    slug: "despliegue",
    file: "guia-despliegue.md",
    description: "Publicar la app en Vercel con Supabase (base de datos, archivos y cron), y más adelante en un servidor propio.",
  },
  {
    slug: "puesta-en-marcha",
    file: "checklist-puesta-en-marcha.md",
    description: "Lista de puesta en marcha de un negocio real: de la instalación vacía a la primera conversación, con la privacidad de OpenRouter, los textos legales, el equipo y las comprobaciones de cada semana y cada mes.",
  },
  {
    slug: "whatsapp",
    file: "guia-whatsapp.md",
    description: "Conectar el número del negocio con la API oficial de Meta: portfolio, app, token, publicación, pago, prueba y problemas.",
  },
];

const GUIDES_DIR = path.join(process.cwd(), "docs");

/** The [guia] part of the address, as it comes from the URL ([SEG-05]). */
const guideSlugSchema = z.string().regex(/^[a-z0-9-]{1,60}$/);

/** The guide of an address, or null: only the guides of the list exist. */
export function findGuide(slug: string): HelpGuide | null {
  if (!guideSlugSchema.safeParse(slug).success) return null;
  return HELP_GUIDES.find((guide) => guide.slug === slug) ?? null;
}

/** The text of a guide of the list (never a path built from the URL). */
export async function readGuide(guide: HelpGuide): Promise<string> {
  return fs.readFile(path.join(GUIDES_DIR, guide.file), "utf8");
}

export type ParsedGuide = {
  /** The first «#» heading of the file. */
  title: string;
  /** The rest, one level up: «##» sections become the page's second-level headings. */
  blocks: Block[];
  /** Index of the sections, with the anchors the rendered headings get (MarkdownText with `anchors`). */
  sections: { id: string; title: string }[];
};

export function parseGuide(source: string): ParsedGuide {
  const all = parseMarkdown(source);
  const titleIndex = all.findIndex((block) => block.type === "heading" && block.level === 1);
  const titleBlock = all[titleIndex];
  const title = titleBlock?.type === "heading" ? inlineText(titleBlock.children) : "";
  const blocks = all
    .filter((_, index) => index !== titleIndex)
    .map((block): Block => (block.type === "heading" ? { ...block, level: Math.max(1, block.level - 1) as 1 | 2 | 3 } : block));
  const anchors = headingAnchors(blocks);
  const sections: ParsedGuide["sections"] = [];
  let heading = 0;
  for (const block of blocks) {
    if (block.type !== "heading") continue;
    if (block.level === 1) sections.push({ id: anchors[heading], title: inlineText(block.children) });
    heading += 1;
  }
  return { title, blocks, sections };
}
