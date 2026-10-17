// The Instagram wizard's steps and links ([IG-01]): pure.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { IG_WIZARD_PATH, IG_WIZARD_STEPS, INSTAGRAM_GUIDE_HREF, INSTAGRAM_META_LINKS, instagramGuideHref, instagramHandle, instagramWizardHref } from "./steps";

describe("the Instagram wizard [IG-01]", () => {
  it("goes through preparing the Meta app, connecting, Meta's notices and the test, in that order", () => {
    expect(IG_WIZARD_STEPS.map((step) => step.label)).toEqual(["Prepara tu app de Meta", "Conectar la cuenta", "Avisos de Meta", "Prueba"]);
  });

  it("[IG-10] connects a disconnected account again with its channel in the address", () => {
    const id = "6f1c2b3a-0000-4000-8000-000000000001";
    expect(instagramWizardHref(id)).toBe(`${IG_WIZARD_PATH}?canal=${id}`);
  });

  it("links only to the official Meta pages checked in docs/integracion-instagram.md «Fuentes»", () => {
    const doc = fs.readFileSync(path.join(process.cwd(), "docs", "integracion-instagram.md"), "utf8");
    const sources = doc.slice(doc.indexOf("## Fuentes"));
    for (const link of Object.values(INSTAGRAM_META_LINKS)) expect(sources, link).toContain(`${link}\n`);
  });

  it("points each «¿Dónde lo encuentro?» to a section of the guide, and writes the account with one «@»", () => {
    expect(instagramGuideHref("token")).toBe(`${INSTAGRAM_GUIDE_HREF}#token`);
    expect(instagramHandle("peluqueria_aurora")).toBe("@peluqueria_aurora");
    expect(instagramHandle("@peluqueria_aurora")).toBe("@peluqueria_aurora");
  });
});
