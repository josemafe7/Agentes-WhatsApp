// A 120-page text PDF for the tests of [CON-23] («un PDF de más de 100 páginas se procesa entero y el agente responde
// un dato de él citando la fuente»): a clinic's manual of treatments with plausible text on every page and one fact
// that appears only on page 87. Made in code, pure and without dependencies (relative imports only, so Vitest and
// Playwright can both load it): the same call always gives the same bytes. The unit tests use the bytes; e2e specs
// can write the file with writeLongPdf() and upload it.
import fs from "node:fs";
import path from "node:path";
import { textPdf, type PdfBlock, type PdfPage } from "../../../../seed/knowledge/pdf";

export const LONG_PDF = {
  fileName: "manual-de-tratamientos.pdf",
  title: "Manual de tratamientos y garantías",
  pageCount: 120,
  /** The only page with the fact (and the only one that names the treatment). */
  factPage: 87,
  fact: "La garantía del tratamiento Zafiro es de 37 meses.",
  treatment: "Zafiro",
  question: "¿Cuántos meses de garantía tiene el tratamiento Zafiro?",
  answer: "37 meses",
} as const;

const TREATMENTS = [
  "limpieza dental",
  "empaste de composite",
  "endodoncia",
  "corona de zirconio",
  "implante unitario",
  "puente fijo",
  "blanqueamiento en consulta",
  "ortodoncia con brackets",
  "carillas de porcelana",
  "tratamiento periodontal",
  "férula de descarga",
  "prótesis removible",
  "odontopediatría",
  "extracción de la muela del juicio",
] as const;

/** Numbers used on the other pages: none of them is 37, so «37 meses» exists only on the fact page. */
const MINUTES = [20, 30, 45, 60, 90];
const HOURS = [2, 24, 48, 72];
const WARRANTY_MONTHS = [12, 24, 36, 48, 60];
const CHECKUP_MONTHS = [3, 6, 12];
const PAGES_PER_CHAPTER = 9;

type Pick = <T>(list: readonly T[]) => T;
type Sentence = (topic: string, pick: Pick) => string;

const SENTENCES: readonly Sentence[] = [
  (t) => `El tratamiento de ${t} se planifica después de una revisión completa y de las pruebas que el odontólogo considere necesarias.`,
  (_, pick) => `La duración media de cada sesión es de ${pick(MINUTES)} minutos, aunque puede variar según el caso de cada paciente.`,
  () => "Antes de empezar, el paciente recibe por escrito el presupuesto, el número de citas previsto y las recomendaciones de cuidado.",
  (_, pick) => `Durante las primeras ${pick(HOURS)} horas conviene evitar alimentos muy calientes o muy fríos y no masticar por la zona tratada.`,
  () => "Si aparece dolor intenso, inflamación o fiebre, el paciente debe llamar a la clínica para que se le dé una cita de revisión.",
  (t, pick) => `La garantía de ${t} es de ${pick(WARRANTY_MONTHS)} meses siempre que se cumplan las revisiones periódicas indicadas.`,
  (_, pick) => `Las revisiones de seguimiento se programan cada ${pick(CHECKUP_MONTHS)} meses durante el primer año.`,
  () => "El precio orientativo incluye la primera revisión posterior; las radiografías adicionales se cobran aparte.",
  () => "En pacientes con diabetes, embarazo o tratamientos anticoagulantes, el odontólogo valorará si hay que adaptar el procedimiento.",
  () => "El consentimiento informado se firma antes de la primera sesión y se guarda en la historia clínica del paciente.",
  () => "Los materiales utilizados cuentan con marcado CE y su lote queda anotado en la ficha del tratamiento.",
  () => "Si el paciente pierde una cita sin avisar, la siguiente se asignará según la disponibilidad de la agenda.",
  () => "La higiene en casa es clave: cepillado tres veces al día, hilo dental o cepillos interproximales y un colutorio sin alcohol.",
  () => "Cualquier cambio en el plan de tratamiento se explica al paciente y se refleja en un nuevo presupuesto antes de aplicarse.",
  (t) => `Las dudas sobre ${t} se resuelven en recepción o por teléfono, y el equipo clínico las anota en la ficha del paciente.`,
  () => "Las citas se pueden cambiar con 24 horas de antelación sin ningún coste para el paciente.",
];

/** Small deterministic generator (mulberry32): the same seed gives the same manual. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function paragraphs(topic: string, next: () => number, count: number): string[] {
  const pick: Pick = (list) => list[Math.floor(next() * list.length)];
  const order = SENTENCES.map((sentence) => ({ sentence, key: next() })).sort((a, b) => a.key - b.key);
  const result: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const group = order.slice(index * 3, index * 3 + 3).map(({ sentence }) => sentence(topic, pick));
    result.push(group.join(" "));
  }
  return result;
}

function coverPage(): PdfPage {
  return [
    { kind: "title", text: LONG_PDF.title },
    { kind: "text", text: "Clínica Dental Lumen · Edición de 2026 · Documento interno para el equipo y los pacientes." },
    {
      kind: "text",
      text: "Este manual recoge, tratamiento por tratamiento, cómo se planifica cada procedimiento, cuánto suele durar, qué cuidados necesita después y qué garantía tiene. Se revisa una vez al año y la versión vigente está siempre en recepción.",
    },
    { kind: "heading", text: "Cómo usar este manual" },
    {
      kind: "text",
      text: "Cada capítulo corresponde a un tratamiento. Las garantías indicadas se aplican siempre que el paciente acuda a las revisiones periódicas y siga las recomendaciones de higiene. Ante cualquier duda, consulta con el equipo clínico.",
    },
    { kind: "heading", text: "Contenido" },
    {
      kind: "text",
      text: `Capítulos: ${TREATMENTS.slice(0, Math.ceil((LONG_PDF.pageCount - 1) / PAGES_PER_CHAPTER)).join(", ")}. Al final de cada capítulo se resumen los cuidados posteriores y las revisiones recomendadas.`,
    },
  ];
}

function chapterPage(pageNumber: number): PdfPage {
  const chapter = Math.floor((pageNumber - 2) / PAGES_PER_CHAPTER);
  const topic = TREATMENTS[chapter % TREATMENTS.length];
  const part = ((pageNumber - 2) % PAGES_PER_CHAPTER) + 1;
  const next = random(pageNumber * 7919);
  const heading: PdfBlock = { kind: "heading", text: `Capítulo ${chapter + 1} · ${topic[0].toUpperCase()}${topic.slice(1)} · parte ${part}` };
  const body = paragraphs(topic, next, 4).map((text): PdfBlock => ({ kind: "text", text }));
  if (pageNumber !== LONG_PDF.factPage) return [heading, ...body];
  // The fact goes in the middle of its page, as a paragraph of its own: never cut across lines, and far enough from
  // the end that the overlap of the next chunk does not carry it to page 88.
  return [
    heading,
    body[0],
    { kind: "text", text: "Tratamientos especiales de la clínica: el tratamiento Zafiro combina alineadores transparentes con revisiones digitales cada seis semanas." },
    { kind: "text", text: LONG_PDF.fact },
    body[1],
    body[2],
    body[3],
  ];
}

/** The pages of the manual: a cover and then chapters of nine pages each. */
export function longPdfPages(): PdfPage[] {
  return Array.from({ length: LONG_PDF.pageCount }, (_, index) => (index === 0 ? coverPage() : chapterPage(index + 1)));
}

let cached: Uint8Array | null = null;

/** The PDF's bytes (a fresh copy each time: PDF.js may take over the buffer it is given). */
export function longPdfBytes(): Uint8Array {
  cached ??= textPdf(longPdfPages(), { title: LONG_PDF.title });
  return new Uint8Array(cached);
}

/** Writes the PDF to `filePath` (folders included) and returns the path, e.g. for a Playwright upload. */
export function writeLongPdf(filePath: string): string {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, longPdfBytes());
  return filePath;
}
