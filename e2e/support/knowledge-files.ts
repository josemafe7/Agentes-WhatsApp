// Documents the knowledge specs upload ([CON-04], [CON-23]), made in code so nothing binary lives in the repository
// and every test can give its copy a name of its own (the same file twice in one base is refused, [CON-14]).
//
//   manualPdf()        «Manual de procedimientos»: a 120-page text PDF (Helvetica, WinAnsi: accents and «ñ» read
//                      back as they are). Every page is a chapter of salon routines of ~250 tokens, so each page is
//                      one fragment with its own page number (src/server/knowledge/chunking.ts). Page 112 alone holds
//                      the fact MANUAL.question asks for; no other page, and not the last lines of that page (which the
//                      next page's fragment repeats as overlap), has any of its words. The builder checks that itself.
//   salonRulesMarkdown() «Normas del salón»: a short Markdown file with headings (no pages). It answers
//                      SALON_RULES.question and has none of the words of SALON_RULES.unknownQuestion.
// The words matter because the simulated OpenRouter (e2e/mocks/routes/bag-of-words.mjs) embeds texts as bags of words
// and the app's word search looks for any of them: a question finds exactly the page that shares its words.

export type UploadFile = { name: string; mimeType: string; buffer: Buffer };

// ─── The 120-page manual ([CON-23]) ─────────────────────────────────────────────────────────────────────

export const MANUAL = {
  pages: 120,
  /** Past page 100: citing it proves the whole PDF was read ([CON-23]). */
  factPage: 112,
  /** What the customer asks («cuántos» is a stop word; the rest only appear on the fact page). */
  question: "¿Cuántos minutos de pausa lleva el tinte vegetal Índigo Nocturno?",
  /** The fact the answer must give. */
  answer: "35 minutos",
  /** The file name: its title is the name without «.pdf» (src/data/knowledge-documents.ts). */
  fileName: (ref: string) => `Manual de procedimientos ${ref}.pdf`,
  title: (ref: string) => `Manual de procedimientos ${ref}`,
} as const;

/** Stems of the question's words: no filler page may have a word starting with one (word search is by prefix). */
const FACT_STEMS = ["minut", "paus", "llev", "tint", "vegetal", "indig", "nocturn"];

type Chapter = { title: string; sentences: readonly string[] };

const CHAPTERS: readonly Chapter[] = [
  {
    title: "Recepción y agenda",
    sentences: [
      "La recepción abre la agenda del día y confirma por teléfono las citas de la mañana.",
      "Cada cliente tiene una ficha con sus datos de contacto y sus preferencias de servicio.",
      "Si alguien llega sin cita, se le ofrece el primer hueco libre y se anota en el cuaderno.",
      "El mostrador se ordena al final de cada turno y se repone el material de oficina.",
      "Las llamadas se atienden con el nombre del salón y con buen tono, aunque haya cola.",
      "Los cambios de hora se confirman por escrito para que el cliente tenga el dato correcto.",
      "La música de la sala se mantiene baja para que se pueda hablar sin levantar la voz.",
      "Antes de cerrar, se revisa la agenda del día siguiente y se preparan las fichas.",
    ],
  },
  {
    title: "Higiene y limpieza",
    sentences: [
      "Las herramientas se desinfectan después de cada servicio con el producto autorizado.",
      "Peines y cepillos se guardan en cajones cerrados, separados por tamaño y por uso.",
      "Las toallas usadas van al cesto azul y se lavan a sesenta grados al terminar el día.",
      "El suelo se barre tras cada corte para que el pelo no se acumule bajo los sillones.",
      "Una vez por semana se hace una limpieza a fondo de lavacabezas, espejos y estanterías.",
      "Las batas de trabajo se cambian a diario y se guardan limpias en la taquilla de cada persona.",
      "Los recipientes de mezcla se lavan con agua caliente y se secan boca abajo sobre la bandeja.",
      "El baño de clientes se revisa a mediodía y a última hora, con su hoja de control firmada.",
    ],
  },
  {
    title: "Almacén y pedidos",
    sentences: [
      "El almacén se revisa cada lunes y se apuntan las existencias en la hoja de control.",
      "Los productos abiertos se marcan con la fecha de apertura en su etiqueta.",
      "Cuando una referencia baja de tres unidades, se avisa a la persona responsable de compras.",
      "Los pedidos a proveedores se hacen los miércoles y suelen llegar antes del viernes.",
      "Nada caducado se usa con clientes: se retira del estante y se anota la baja.",
      "Las cajas vacías se pliegan y se dejan en el contenedor de cartón del patio.",
      "Los productos de venta al público se colocan con la etiqueta de precio hacia fuera.",
      "Las muestras gratuitas se entregan solo con una compra o al terminar un servicio largo.",
    ],
  },
  {
    title: "Cortes",
    sentences: [
      "Antes de cortar, se pregunta al cliente el largo que quiere y se confirma frente al espejo.",
      "El corte a tijera se remata con navaja solo si el cliente lo pide de forma expresa.",
      "Las puntas abiertas se sanean con un corte recto de medio centímetro.",
      "En los cortes infantiles se usa la silla elevadora y se trabaja con calma y paciencia.",
      "Al terminar, se enseña la nuca con el espejo de mano y se pregunta si falta algún retoque.",
      "El flequillo se corta en seco, porque el cabello mojado engaña sobre el largo final.",
      "Las máquinas se limpian con cepillo y aceite al acabar cada jornada de trabajo.",
      "Los cortes masculinos se degradan de abajo arriba, con el peine como guía.",
    ],
  },
  {
    title: "Peinados y recogidos",
    sentences: [
      "Los recogidos de evento se prueban unos días antes para ajustar horquillas y volumen.",
      "El secado con cepillo empieza por la nuca y termina por la parte de delante.",
      "Las ondas al agua se fijan con laca ligera para que duren toda la jornada.",
      "Para bodas se reserva el sillón junto a la ventana, que tiene más luz natural.",
      "El planchado se hace con protector térmico y por mechones finos.",
      "Las trenzas se sujetan con gomas transparentes para que no se vean en las fotos.",
      "El volumen en la raíz se consigue con un cardado suave y un poco de espuma.",
      "Se enseña al cliente cómo retocar el peinado en casa con sus propias manos.",
    ],
  },
  {
    title: "Tratamientos capilares",
    sentences: [
      "La hidratación profunda se aplica en el lavacabezas y se retira con agua templada.",
      "El masaje craneal relaja al cliente y activa la circulación del cuero cabelludo.",
      "La keratina se sella con plancha en mechones finos y sin prisas.",
      "Tras cada tratamiento se recomienda un cuidado suave para casa.",
      "Los resultados se anotan en la ficha para repetir lo que ha funcionado.",
      "Un cuero cabelludo irritado no recibe ningún tratamiento hasta que se calme.",
      "Las mascarillas se reparten con espátula limpia, nunca con los dedos.",
      "El cliente recibe por escrito los cuidados de los días siguientes.",
    ],
  },
  {
    title: "Manicura y pedicura",
    sentences: [
      "Las limas se desechan tras cada cliente y los alicates pasan por el esterilizador.",
      "El esmaltado semipermanente se cura en la lámpara por capas finas.",
      "Antes de empezar se revisa que las uñas no tengan heridas ni hongos.",
      "La pedicura se hace en el sillón con reposapiés y agua con sales.",
      "Se ofrece crema de manos al terminar y se enseñan los colores de temporada.",
      "Las cutículas se empujan con suavidad y solo se cortan las pieles sueltas.",
      "El quitaesmalte sin acetona se usa en uñas débiles o muy finas.",
      "Cada puesto de manicura tiene su propia lámpara, su bandeja y su papelera.",
    ],
  },
  {
    title: "Atención al cliente y quejas",
    sentences: [
      "Si un cliente no queda contento, se le escucha sin interrumpir y se busca una solución.",
      "Las quejas se apuntan en el libro de incidencias con la fecha y el nombre.",
      "Un retoque gratuito se ofrece durante los siete días siguientes al servicio.",
      "Nunca se discute delante de otros clientes: se habla en la zona tranquila.",
      "La responsable del salón revisa las incidencias cada viernes por la tarde.",
      "Las opiniones buenas también se apuntan, para saber qué hacemos bien.",
      "A quien espera más de lo previsto se le ofrece agua, café o una revista.",
      "Los datos de los clientes no se comentan fuera del salón ni en redes sociales.",
    ],
  },
  {
    title: "Caja y pagos",
    sentences: [
      "La caja se abre con el fondo fijo y se cuadra al cerrar con el informe del terminal.",
      "Se aceptan tarjeta, efectivo y pago con el móvil.",
      "Los bonos regalo se registran con su número y su fecha de validez.",
      "Las propinas se guardan en el bote común y se reparten a final de mes.",
      "Cualquier descuadre se comunica el mismo día a la responsable del salón.",
      "Las facturas se piden en recepción y se envían por correo electrónico.",
      "Los precios de la carta se revisan cada enero y se cuelgan junto a la entrada.",
      "Las devoluciones de productos se aceptan con el tique y el envase cerrado.",
    ],
  },
  {
    title: "Seguridad y salud laboral",
    sentences: [
      "Los guantes de nitrilo se usan en cualquier servicio con productos químicos.",
      "El botiquín está junto a la puerta del almacén y se revisa cada trimestre.",
      "Las salidas de emergencia deben quedar siempre despejadas.",
      "Si alguien se corta, se limpia la herida, se tapa y se anota en el registro.",
      "La ventilación se enciende al empezar la jornada y se apaga al cerrar.",
      "Los enchufes de los secadores se revisan cada mes y se cambian si se calientan.",
      "Las sillas de trabajo se regulan a la altura de cada persona para cuidar la espalda.",
      "Cada año el equipo repasa el plan de evacuación con un simulacro.",
    ],
  },
];

/** The fact page: the fact first, then a closing without any of its words (the next fragment repeats the last lines). */
const FACT_PAGE_TITLE = "Coloración natural";
const FACT_PAGE_SENTENCES = [
  "El tinte vegetal Índigo Nocturno lleva una pausa de 35 minutos exactos con calor suave.",
  "El Índigo Nocturno se mezcla con agua tibia hasta formar una crema sin grumos.",
  "Este tinte vegetal da reflejos azulados sobre bases oscuras y cubre las primeras canas.",
  "Durante la pausa, el cliente espera con gorro térmico y se le ofrece una bebida.",
  "Al aclarar, se usa agua templada y un acondicionador sin siliconas.",
  "Después se seca con difusor para respetar la forma natural del cabello.",
  "El resultado se anota en la ficha del cliente con la fecha del servicio.",
  "La mezcla sobrante no se guarda: se tira al cubo de orgánico al terminar.",
  "La zona de trabajo se deja limpia y seca para el siguiente cliente de la tarde.",
  "Si el cliente tiene dudas, se le da por escrito la hoja de cuidados de casa.",
];

/** Lower case without accents, for the self-check. */
function plain(text: string): string {
  return text.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
}

function wordsOf(text: string): string[] {
  return plain(text).match(/[\p{L}\p{N}]+/gu) ?? [];
}

function hasFactWord(text: string): boolean {
  return wordsOf(text).some((word) => FACT_STEMS.some((stem) => word.startsWith(stem)));
}

/** The text of one page (a title line and its sentences). */
function pageText(page: number): { heading: string; sentences: string[] } {
  const chapterNumber = Math.floor((page - 1) / 12) + 1;
  if (page === MANUAL.factPage) return { heading: `Capítulo ${chapterNumber}. ${FACT_PAGE_TITLE}. Sección ${page}.`, sentences: FACT_PAGE_SENTENCES };
  const chapter = CHAPTERS[(page - 1) % CHAPTERS.length];
  // Rotated, so pages of the same chapter are not identical.
  const shift = Math.floor((page - 1) / CHAPTERS.length) % chapter.sentences.length;
  const sentences = [...chapter.sentences.slice(shift), ...chapter.sentences.slice(0, shift)];
  const heading = `Capítulo ${chapterNumber}. ${chapter.title}. Sección ${page}.`;
  return { heading, sentences: [...sentences, `Esta sección la revisa el equipo del turno ${["de mañana", "de tarde", "de sábado"][page % 3]} en la reunión mensual.`] };
}

/** Wraps a paragraph into lines of at most `width` characters, at spaces. */
function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

// WinAnsi (cp1252): Latin-1 as is, plus the typographic characters of 0x80–0x9F that a Spanish text may use.
const CP1252_EXTRAS: Record<string, number> = { "€": 0x80, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "–": 0x96, "—": 0x97 };

function winAnsi(text: string): number[] {
  return [...text].map((char) => {
    const extra = CP1252_EXTRAS[char];
    if (extra !== undefined) return extra;
    const code = char.charCodeAt(0);
    return code <= 0xff ? code : 0x3f;
  });
}

/** A PDF literal string «(…)» with backslashes and parentheses escaped. */
function literal(text: string): number[] {
  const bytes: number[] = [0x28];
  for (const byte of winAnsi(text)) {
    if (byte === 0x5c || byte === 0x28 || byte === 0x29) bytes.push(0x5c);
    bytes.push(byte);
  }
  bytes.push(0x29);
  return bytes;
}

const ascii = (text: string) => [...Buffer.from(text, "latin1")];

/** A text PDF with one page per entry of `pages` (each a list of lines), A4, Helvetica 10 pt. */
export function textPdf(pages: readonly (readonly string[])[]): Buffer {
  const fontId = 3;
  const objects: number[][] = [];
  const pageIds = pages.map((_, index) => 4 + index * 2);
  objects[1] = ascii("<< /Type /Catalog /Pages 2 0 R >>");
  objects[2] = ascii(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  objects[fontId] = ascii("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  pages.forEach((lines, index) => {
    const pageId = pageIds[index];
    // Each line ends in a space, so words never run together whatever line breaks the reader finds.
    const content = [
      ...ascii("BT /F1 10 Tf 14 TL 60 780 Td\n"),
      ...lines.flatMap((line, lineIndex) => [...(lineIndex > 0 ? ascii("T* ") : []), ...literal(`${line} `), ...ascii(" Tj\n")]),
      ...ascii("ET\n"),
    ];
    objects[pageId] = ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${pageId + 1} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`);
    objects[pageId + 1] = [...ascii(`<< /Length ${content.length} >>\nstream\n`), ...content, ...ascii("endstream")];
  });

  const out: number[] = [...ascii("%PDF-1.4\n%"), 0xe2, 0xe3, 0xcf, 0xd3, 0x0a];
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = out.length;
    out.push(...ascii(`${id} 0 obj\n`), ...objects[id], ...ascii("\nendobj\n"));
  }
  const xref = out.length;
  const entries = offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  out.push(...ascii(`xref\n0 ${objects.length}\n0000000000 65535 f \n${entries}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  return Buffer.from(out);
}

const LINE_WIDTH = 88;
/** How much of the end of the fact page must stay free of the fact's words (the next fragment's overlap is ~60 tokens). */
const FACT_PAGE_CLEAN_TAIL_CHARS = 420;

/** The pages of the manual as lines (checked: the fact's words only on the fact page, and not in its last lines). */
export function manualPages(): string[][] {
  const pages: string[][] = [];
  for (let page = 1; page <= MANUAL.pages; page += 1) {
    const { heading, sentences } = pageText(page);
    const lines = [heading, ...wrap(sentences.join(" "), LINE_WIDTH)];
    const text = lines.join(" ");
    if (page !== MANUAL.factPage && hasFactWord(text)) throw new Error(`Page ${page} of the manual has a word of the question.`);
    if (page === MANUAL.factPage && hasFactWord(text.slice(-FACT_PAGE_CLEAN_TAIL_CHARS))) {
      throw new Error("The last lines of the fact page have a word of the question: the next fragment would repeat it.");
    }
    pages.push(lines);
  }
  return pages;
}

/** The 120-page manual as an upload (named after `ref`, so each test's copy is its own document). */
export function manualPdf(ref: string): UploadFile {
  return { name: MANUAL.fileName(ref), mimeType: "application/pdf", buffer: textPdf(manualPages()) };
}

// ─── «Normas del salón» ([CON-18], [CON-20]) ────────────────────────────────────────────────────────────

export const SALON_RULES = {
  fileName: (ref: string) => `Normas del salon ${ref}.md`,
  title: (ref: string) => `Normas del salon ${ref}`,
  /**
   * Answered by the «Reservas de recogidos» section. No word of the template agents' hand-off keywords (the
   * peluquería template passes «novia» and «boda» to a person, src/lib/sectors/peluqueria.ts), or a live reply would
   * be the hand-off message instead of the knowledge.
   */
  question: "¿Qué señal hay que pagar para reservar un recogido de fiesta?",
  answer: "30 euros",
  /** None of its words is in the document (nor in its title). */
  unknownQuestion: "¿Hacéis envíos de champú a Canarias?",
} as const;

export function salonRulesMarkdown(ref: string): UploadFile {
  const text = [
    `# Normas del salón`,
    "",
    "## Retrasos",
    "Si llegas con más de quince minutos de retraso, intentaremos atenderte, pero puede que haya que acortar el servicio o darte otra hora.",
    "Avísanos por teléfono si ves que no llegas: así reorganizamos la mañana sin que nadie espere.",
    "",
    "## Reservas de recogidos",
    "Las reservas de recogidos de fiesta piden una señal de 30 euros al reservar el recogido de fiesta.",
    "La señal del recogido se descuenta del precio final y se paga en recepción o con tarjeta.",
    "La prueba del recogido de fiesta se hace unas semanas antes de la celebración, con el tocado y las horquillas.",
    "",
    "## Menores",
    "Los menores de dieciséis años vienen acompañados de una persona adulta durante todo el servicio.",
    "",
  ].join("\n");
  return { name: SALON_RULES.fileName(ref), mimeType: "text/markdown", buffer: Buffer.from(text, "utf8") };
}
