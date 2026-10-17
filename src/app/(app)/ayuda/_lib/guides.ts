// Guides of Ayuda ([AJU-17], [ARR-23]): the docs/guia-*.md files (and, from phase 7, the start-up checklist). They
// are read on the server from docs/, and next.config.ts adds those files to the output of the /ayuda pages when the
// app is compiled (outputFileTracingIncludes), so a published app carries them without the repository.
// Each phase adds its guide here, in its group of the list; a test checks that none of docs/ is missing.
import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { headingAnchors, inlineText, parseMarkdown, type Block } from "@/lib/markdown";

/** Groups of the list of guides, in the order they are shown: where to start first, then what each guide sets up. */
export const HELP_GUIDE_GROUPS = [
  { key: "start", title: "Para empezar" },
  { key: "channels", title: "Canales" },
  { key: "agents", title: "Agentes y conocimiento" },
  { key: "agenda", title: "Agenda" },
  { key: "campaigns", title: "Envíos" },
] as const;

export type HelpGuideGroup = (typeof HELP_GUIDE_GROUPS)[number];

export type HelpGuide = {
  /** Address: /ayuda/<slug>. */
  slug: string;
  /** File in docs/. */
  file: string;
  /** Group of the list of guides it is shown in. */
  group: HelpGuideGroup["key"];
  /** One line for the list of guides. */
  description: string;
};

/** In the order the list shows them inside each group. */
export const HELP_GUIDES: readonly HelpGuide[] = [
  {
    slug: "puesta-en-marcha",
    file: "checklist-puesta-en-marcha.md",
    group: "start",
    description: "Lista de puesta en marcha de un negocio real: de la instalación vacía a la primera conversación, con la privacidad de OpenRouter, los textos legales, el equipo y las comprobaciones de cada semana y cada mes.",
  },
  {
    slug: "despliegue",
    file: "guia-despliegue.md",
    group: "start",
    description: "Publicar la app en Vercel con Supabase (base de datos, archivos y cron), o en un servidor propio con Dokploy y Supabase.",
  },
  {
    slug: "whatsapp",
    file: "guia-whatsapp.md",
    group: "channels",
    description: "Conectar el número del negocio con la API oficial de Meta: portfolio, app, token, publicación, pago, prueba y problemas.",
  },
  {
    slug: "whatsapp-ycloud",
    file: "guia-whatsapp-ycloud.md",
    group: "channels",
    description: "Conectar WhatsApp con YCloud y coexistencia (el número sigue en la app del móvil): el alta en YCloud, la clave, el modo pruebas, las plantillas y los problemas frecuentes.",
  },
  {
    slug: "whatsapp-qr",
    file: "guia-whatsapp-qr.md",
    group: "channels",
    description: "Conectar WhatsApp escaneando un código, como WhatsApp Web: los riesgos de esta vía no oficial, qué necesita, el modo pruebas, qué lee la app y los problemas frecuentes.",
  },
  {
    slug: "correo",
    file: "guia-correo.md",
    group: "channels",
    description: "Conectar un buzón de Gmail (Google Cloud), Outlook o Microsoft 365 (Microsoft Entra) u otro servidor IMAP/SMTP: paso a paso, modos de respuesta, filtros y problemas.",
  },
  {
    slug: "telegram",
    file: "guia-telegram.md",
    group: "channels",
    description: "Conectar un bot de Telegram: crearlo con @BotFather, pegar su token, el modo local, el enlace y el código QR para tus clientes y los problemas frecuentes.",
  },
  {
    slug: "instagram",
    file: "guia-instagram.md",
    group: "channels",
    description: "Conectar los mensajes directos de la cuenta de Instagram del negocio: la cuenta profesional, la app de Meta, el token y la clave, los avisos de Meta, la prueba desde otra cuenta, la ventana de 24 horas y los problemas frecuentes.",
  },
  {
    slug: "agentes-y-conocimiento",
    file: "guia-agentes-y-conocimiento.md",
    group: "agents",
    description: "Crear un agente desde la plantilla de tu sector, darle el conocimiento del negocio (archivos y bases), probarlo y ver de dónde saca cada respuesta.",
  },
  {
    slug: "asistentes-internos",
    file: "guia-asistentes-internos.md",
    group: "agents",
    description: "Crear un agente interno para tu equipo: su base de conocimiento interna, a quién le das acceso, cómo se usa en «Asistentes», la privacidad de lo que se pregunta y los documentos grandes.",
  },
  {
    slug: "agenda",
    file: "guia-agenda.md",
    group: "agenda",
    description: "Preparar la agenda del negocio: palabras, servicios, recursos, horarios, ausencias, modo por recurso o por aforo, recordatorios y qué hace el agente con las citas.",
  },
  {
    slug: "envios",
    file: "guia-envios.md",
    group: "campaigns",
    description: "Mandar novedades y publicidad por WhatsApp, Telegram o correo: el permiso de los clientes, importarlos, la plantilla de publicidad, programar un envío, el correo con un servicio de envíos (SPF, DKIM y DMARC), las normas y cómo evitar bloqueos.",
  },
];

/** The guides as the list shows them: by group, in the order of the groups and without the groups nothing is in. */
export function groupGuides<Guide extends HelpGuide>(guides: readonly Guide[]): (HelpGuideGroup & { guides: Guide[] })[] {
  return HELP_GUIDE_GROUPS.map((group) => ({ ...group, guides: guides.filter((guide) => guide.group === group.key) })).filter(
    (group) => group.guides.length > 0,
  );
}

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
