// What a row of a contacts file says ([CTO-11]): columns by their title, phones with the chosen prefix, «sí» / «no»,
// dates and how each permission was given, and every reason a row cannot go in.
import { describe, expect, it } from "vitest";
import { IMPORT_TEMPLATE_COLUMNS, isEmptyRow, normalizeImportEmail, normalizeImportPhone, parseImportDate, parseMethod, parseYesNo, readImportRow, recogniseColumns, rowsGrantPermissions } from "./contact-import";

const NOW = new Date("2026-10-16T10:00:00Z");
const template = recogniseColumns(IMPORT_TEMPLATE_COLUMNS.map((column) => column.title));
const read = (cells: unknown[], prefix = "34") => readImportRow(cells, 2, template, { prefix, now: NOW });

describe("contacts file [CTO-11]", () => {
  it("recognises the template's titles and others in any case or accents, and says which it does not know", () => {
    expect(Object.keys(template.fields)).toHaveLength(IMPORT_TEMPLATE_COLUMNS.length);
    const other = recogniseColumns(["  TELÉFONO móvil ", "Correo electrónico", "Cliente", "Avisos", "Publicidad", "Notas", ""]);
    expect(other.fields).toEqual({ phone: 0, email: 1, name: 2, remindersGranted: 3, marketingGranted: 4 });
    expect(other.unknown).toEqual(["Notas"]);
  });

  it("a phone without a prefix takes the chosen one; with + or 00 it keeps its own; letters or too short are not phones", () => {
    expect(normalizeImportPhone("600 11 22 33", "34")).toBe("34600112233");
    expect(normalizeImportPhone("600112233", "351")).toBe("351600112233");
    expect(normalizeImportPhone("+34 600-11-22-33", "52")).toBe("34600112233");
    expect(normalizeImportPhone("0034 600112233", "52")).toBe("34600112233");
    // Excel keeps «+34 600 11 22 33» as the number 34600112233: 11 digits or more already carry the code.
    expect(normalizeImportPhone("34600112233", "34")).toBe("34600112233");
    expect(normalizeImportPhone("600 11 aa 33", "34")).toBeNull();
    expect(normalizeImportPhone("123", "34")).toBeNull();
    expect(normalizeImportPhone("+1234567890123456", "34")).toBeNull();
  });

  it("«sí» and «no» in their usual ways; anything else is a mistake; empty says nothing", () => {
    for (const yes of ["sí", "Si", "SÍ", "x", "1", "yes"]) expect(parseYesNo(yes)).toBe(true);
    for (const no of ["no", "NO", "0", "n"]) expect(parseYesNo(no)).toBe(false);
    expect(parseYesNo("")).toBeNull();
    expect(parseYesNo("quizás")).toBe("invalid");
  });

  it("dates as people write them or as Excel keeps them, never in the future", () => {
    expect(parseImportDate("15/09/2026", NOW)).toEqual(new Date("2026-09-15T12:00:00Z"));
    expect(parseImportDate("2026-09-15", NOW)).toEqual(new Date("2026-09-15T12:00:00Z"));
    expect(parseImportDate(new Date("2026-09-15T00:00:00Z"), NOW)).toEqual(new Date("2026-09-15T00:00:00Z"));
    expect(parseImportDate("", NOW)).toBeNull();
    expect(parseImportDate("31/02/2026", NOW)).toBe("invalid");
    expect(parseImportDate("01/12/2026", NOW)).toBe("invalid");
    expect(parseImportDate("ayer", NOW)).toBe("invalid");
  });

  it("how it was given: known ways, «otro» with the text as a note, «importado» when it does not say", () => {
    expect(parseMethod("En persona")).toEqual({ method: "in_person", note: null });
    expect(parseMethod("por escrito")).toEqual({ method: "written", note: null });
    expect(parseMethod("")).toEqual({ method: "imported", note: null });
    expect(parseMethod("Lo dijo por teléfono")).toEqual({ method: "other", note: "Lo dijo por teléfono" });
  });

  it("a good row brings its data, labels and permissions", () => {
    const result = read(["  Laura   Gil ", "600 11 22 33", "Laura@Ejemplo.com", "habitual; mañanas, habitual", "sí", "15/09/2026", "en persona", "no", "", ""]);
    expect(result).toEqual({
      ok: true,
      row: {
        line: 2,
        name: "Laura Gil",
        phone: "34600112233",
        email: "laura@ejemplo.com",
        labels: ["habitual", "mañanas"],
        permissions: {
          reminders: { granted: true, givenAt: new Date("2026-09-15T12:00:00Z"), method: "in_person", note: null },
          marketing: { granted: false, givenAt: null, method: "imported", note: null },
        },
      },
    });
    expect(rowsGrantPermissions(result.ok ? [result.row] : [])).toBe(true);
  });

  it("an email is valid as everywhere else in the app", () => {
    for (const bad of ["ana@ejemplo..com", "ana..gil@ejemplo.com", "a<b>@x.com"]) expect(normalizeImportEmail(bad), bad).toBeNull();
    expect(normalizeImportEmail(" Ana@Ejemplo.com ")).toBe("ana@ejemplo.com");
  });

  it("every reason a row cannot go in, together: bad phone or email, neither of them, a permission that is not «sí» or «no», a wrong date", () => {
    expect(read(["Ana", "60x", "ana@", "", "", "", "", "", "", ""])).toEqual({
      ok: false,
      line: 2,
      errors: ["El teléfono «60x» no es válido.", "El email «ana@» no es válido."],
    });
    expect(read(["Solo nombre", "", "", "", "", "", "", "", "", ""])).toMatchObject({ ok: false, errors: ["No tiene teléfono ni email: no se le podría escribir ni reconocer al importarlo otra vez."] });
    expect(read(["Pepe", "600112233", "", "", "a veces", "", "", "sí", "mañana", ""])).toMatchObject({
      ok: false,
      errors: ["«Avisos de sus citas» tiene que decir «sí» o «no».", "La fecha de «Novedades y publicidad» no es una fecha pasada (escríbela como 15/09/2026)."],
    });
  });

  it("a row without any permission column, or with them empty, gives none; an empty row is not counted", () => {
    const short = readImportRow(["Luis", "611223344"], 3, recogniseColumns(["Nombre", "Teléfono"]), { prefix: "34", now: NOW });
    expect(short).toMatchObject({ ok: true, row: { permissions: {} } });
    expect(rowsGrantPermissions(short.ok ? [short.row] : [])).toBe(false);
    expect(isEmptyRow(["", null, undefined, "  "])).toBe(true);
    expect(isEmptyRow(["", "x"])).toBe(false);
  });
});
