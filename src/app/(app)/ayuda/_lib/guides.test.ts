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

describe("the agents and knowledge guide [ARR-23]", () => {
  const guide = HELP_GUIDES.find((candidate) => candidate.file === "guia-agentes-y-conocimiento.md");

  it("is in Spanish and explains creating, tuning, testing and restoring an agent, and not uploading customer data", async () => {
    expect(guide).toBeDefined();
    const text = guide ? await readGuide(guide) : "";
    for (const topic of ["Nuevo agente", "Plantilla de tu sector", "Generar borrador con IA", "Instrucciones", "Modelo", "Traspaso", "Probar", "Simular canal", "Versiones", "Restaurar esta versión", "clave de OpenRouter", "no subas datos de clientes"]) {
      expect(text, topic).toContain(topic);
    }
    expect(text.match(/\[Captura: /g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("explains putting an agent to answer in a channel and why it may not answer [CAN-03] [CAN-04] [AGE-10] [AGE-14]", async () => {
    const text = guide ? await readGuide(guide) : "";
    for (const topic of ["Agente activo", "Sustituir", "Activo aquí", "/widget-demo", "Simulador", "Borrador para revisar", "IA en pausa hasta", "Modo pruebas"]) {
      expect(text, topic).toContain(topic);
    }
  });

  it("explains the knowledge: context files, bases and their content, states, the test search, the agent's bases, sources and FAQs [CON-01]–[CON-22] [AGE-07] [AJU-05]", async () => {
    const text = guide ? await readGuide(guide) : "";
    for (const topic of [
      "Archivos de contexto",
      "30.000",
      "Pasar a una base de conocimiento",
      "Nueva base",
      "Añadir contenido",
      "mapa del sitio",
      "Pregunta frecuente",
      "Listo (solo texto)",
      "Mistral OCR",
      "Este archivo ya está en la base",
      "Probar búsqueda",
      "Nada relevante",
      "Buscar en el conocimiento",
      "Buscar siempre",
      "no lo sabe y ofrece pasar con una persona",
      "¿Por qué respondió esto?",
      "Convertir en FAQ",
      "Reindexar",
      "1536",
    ]) {
      expect(text, topic).toContain(topic);
    }
    expect(text).not.toMatch(/se completará|próxima versión/);
  });
});

describe("the WhatsApp guide [ARR-23] [WA-01] [WA-09] [WA-30]", () => {
  const guide = HELP_GUIDES.find((candidate) => candidate.file === "guia-whatsapp.md");
  const guideText = async () => (guide ? readGuide(guide) : "");

  it("is at /ayuda/whatsapp, with one section for each «¿Dónde lo encuentro?» of the wizard", async () => {
    expect(guide?.slug).toBe("whatsapp");
    const ids = parseGuide(await guideText()).sections.map((section) => section.id);
    const wizardAnchors = [
      "portfolio", "app", "numero", "usuario-del-sistema", "token", "app-secret", "phone-number-id", "pin", "webhook",
      "publicar-app", "metodo-de-pago", "plantillas", "prueba", "problemas",
    ];
    for (const anchor of wizardAnchors) expect(ids, anchor).toContain(anchor);
    // The wizard's own list, so a new «¿Dónde lo encuentro?» never points to a missing section.
    const { GUIDE_ANCHORS } = await import("@/app/(app)/canales/nuevo/whatsapp/_lib/help");
    for (const anchor of GUIDE_ANCHORS) expect(ids, anchor).toContain(anchor);
  });

  it("covers the portfolio, the app, the number, limits, payment, publishing, the 15-app cap and the Meta test number", async () => {
    const text = await guideText();
    for (const topic of [
      // The business owns the portfolio and gives admin access to whoever sets it up; the app goes in that portfolio.
      "portfolio empresarial", "control total", "Connect with customers through WhatsApp", "el del negocio",
      // The number leaves the phone app.
      "deja de funcionar en la app WhatsApp", "Eliminar cuenta",
      // Where each field comes from.
      "Usuarios del sistema", "«Nunca»", "whatsapp_business_management", "whatsapp_business_messaging",
      "Configuración de la app › Básica", "API Setup", "/api/webhooks/whatsapp", "Verificar y guardar", "messages",
      // Limits without verification and when to verify.
      "250", "2.000", "2 números", "verificar la empresa", "propósito general",
      // Payment method and publishing (Live) with the legal pages.
      "Centro de facturación", "1.000 mensajes de servicio gratis", "1-10-2026", "Live", "/legal/terminos",
      "/legal/privacidad", "/legal/eliminacion-datos", "App Review",
      // The 15-app cap.
      "15 apps", "administra su propia app",
      // The real check with Meta's test number, step by step.
      "Número de prueba de Meta", "«To»", "«hola»", "Enviar respuesta de prueba", "Bandeja", "modo pruebas",
    ]) {
      expect(text, topic).toContain(topic);
    }
    expect(text.match(/\[Captura: /g)?.length ?? 0).toBeGreaterThanOrEqual(8);
  });

  it("explains frequent problems with cause and fix, quoting the Spanish messages the app shows for Meta's codes", async () => {
    const { META_ERRORS } = await import("@/lib/meta/errors");
    const text = await guideText();
    const problems = text.slice(text.indexOf("\n## Problemas"));
    expect(problems.length).toBeGreaterThan(20);
    expect(problems.match(/Causa: /g)?.length ?? 0).toBeGreaterThanOrEqual(20);
    expect(problems.match(/Solución: /g)?.length ?? 0).toBeGreaterThanOrEqual(20);
    for (const code of [190, 200, 100, 133016, 133005, 133006, 133010, 136024, 131042, 131047, 131026, 368, 131056, 132001]) {
      expect(problems, String(code)).toContain(`(${code}`);
      expect(problems, String(code)).toContain(META_ERRORS[code].message);
    }
  });
});
