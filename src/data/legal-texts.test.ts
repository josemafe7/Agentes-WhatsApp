// The default legal texts ([CUM-08]) only promise «BAJA» where the app reads it, a conversation of a channel
// ([CUM-03]): a reminder by email may come from the system mail, whose answers a person reads ([AGD-24], [AGD-26]).
import { describe, expect, it } from "vitest";
import { DEFAULT_RETENTION } from "@/db/schema";
import { defaultLegalTexts, type LegalBusinessData } from "./legal-texts";

const business: LegalBusinessData = { name: "Peluquería Aurora", contactEmail: "hola@aurora.example", contactPhone: "600 000 000", address: null, retention: DEFAULT_RETENTION };

const sentences = (text: string) => text.split(/(?<=[.:])\s+/);

describe("stopping reminders in the default legal texts [CUM-08] [CUM-03] [AGD-24]", () => {
  it("say how to stop them in each channel, with the business's contact for email", () => {
    const { privacy, terms, dataDeletion } = defaultLegalTexts(business);
    const byEmail = "responde al recordatorio pidiéndolo o escríbenos a hola@aurora.example o al 600 000 000.";
    expect(privacy).toContain("Por WhatsApp, deja de recibirlos escribiendo BAJA en nuestra conversación.");
    expect(privacy).toContain(`Si te llegan por correo, ${byEmail}`);
    for (const text of [terms, dataDeletion]) {
      expect(text).toContain("escribe BAJA o STOP en esa conversación.");
      expect(text).toContain(`Si un recordatorio te llega por correo, ${byEmail}`);
    }
  });

  it("never tell the customer to write «BAJA» or «STOP» by email", () => {
    for (const [kind, text] of Object.entries(defaultLegalTexts(business))) {
      for (const sentence of sentences(text).filter((line) => /correo/i.test(line))) {
        expect(sentence, kind).not.toMatch(/\bBAJA\b|\bSTOP\b/);
      }
    }
  });

  it("without contact details, point to the channel the customer used, in good Spanish", () => {
    const texts = defaultLegalTexts({ ...business, contactEmail: null, contactPhone: null });
    expect(texts.privacy).toContain("escríbenos a través del mismo canal por el que nos escribiste");
    expect(texts.privacy).not.toContain("a el mismo canal");
  });
});
