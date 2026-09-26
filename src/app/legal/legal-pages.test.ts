// The public legal pages render the texts of Ajustes › Privacidad y legal, escaped, without a session
// ([CUM-08], [PER-09]). No auth or headers mock here: if a page asked for the session, these tests would fail.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { createBusiness } from "@/test/factories";
import DataDeletionPage, { generateMetadata as dataDeletionMetadata } from "./eliminacion-datos/page";
import PrivacyPage, { dynamic, generateMetadata as privacyMetadata } from "./privacidad/page";
import TermsPage from "./terminos/page";

const HOSTILE = '# Privacidad\n\n<script>alert("x")</script>\n\n<img src=x onerror=alert(1)>\n\nTexto **propio**.';

beforeEach(async () => {
  await createBusiness({
    name: "Peluquería Aurora",
    contactEmail: "hola@aurora.example",
    address: "Calle Mayor 1, Madrid",
    logoFileKey: null,
    privacyText: HOSTILE,
    termsText: null,
    dataDeletionText: null,
  });
});

describe("public legal pages [CUM-08]", () => {
  it("are rendered on every request, never frozen at build time", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("show the configured privacy text escaped, never as HTML", async () => {
    const html = renderToStaticMarkup(await PrivacyPage());
    expect(html).toContain("Peluquería Aurora");
    expect(html).toContain('<strong class="font-semibold">propio</strong>');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
  });

  it("use the default text with the business data when nothing is configured", async () => {
    const terms = renderToStaticMarkup(await TermsPage());
    expect(terms).toContain("Peluquería Aurora");
    expect(terms).toContain("persona");
    const deletion = renderToStaticMarkup(await DataDeletionPage());
    expect(deletion).toContain('href="mailto:hola@aurora.example"');
  });

  it("link to each other and show the business contact data", async () => {
    const html = renderToStaticMarkup(await TermsPage());
    for (const href of ["/legal/privacidad", "/legal/terminos", "/legal/eliminacion-datos"]) {
      expect(html).toContain(`href="${href}"`);
    }
    expect(html).toContain("Calle Mayor 1, Madrid");
  });

  it("show the business logo through the file route", async () => {
    await createBusiness({ logoFileKey: "logos/2026/09/0b0f6c1e-7d7a-4d7c-9c55-2f1f7b0d9a11.png" });
    const html = renderToStaticMarkup(await PrivacyPage());
    expect(html).toContain('src="/api/files/logos/2026/09/0b0f6c1e-7d7a-4d7c-9c55-2f1f7b0d9a11.png"');
  });

  it("have a title with the business name (not the product's)", async () => {
    expect((await privacyMetadata()).title).toEqual({ absolute: "Política de privacidad · Peluquería Aurora" });
    expect((await dataDeletionMetadata()).title).toEqual({ absolute: "Eliminación de datos · Peluquería Aurora" });
  });
});
