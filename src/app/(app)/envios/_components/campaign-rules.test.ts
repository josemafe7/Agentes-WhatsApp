// The rules of envíos in a few lines on the Envíos screens ([CUM-15], [CUM-14]), rendered: the three of the LSSI and the
// link to the guide; the health-data notice only in a sector with health data.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CampaignRules } from "./campaign-rules";

const textOf = (html: string) => html.replace(/<[^>]*>/g, "");

describe("CampaignRules [CUM-15]", () => {
  it("sums up the rules before sending publicidad: permission (art. 21), an easy baja (art. 22), clear who sends it (art. 20), and the guide", () => {
    const html = renderToStaticMarkup(createElement(CampaignRules, { healthData: false }));
    const text = textOf(html);
    expect(text).toContain("Antes de enviar publicidad");
    expect(text).toMatch(/Solo a quien la aceptó expresamente: el permiso «Novedades y publicidad» \(LSSI art\. 21\)/);
    expect(text).toMatch(/darse de baja fácil y gratis.*\(art\. 22\)/);
    expect(text).toMatch(/Que se vea que es publicidad y quién la envía.*sus condiciones \(art\. 20\)/);
    expect(html).toMatch(/<a [^>]*href="\/ayuda\/envios"[^>]*>.*Guía de envíos<\/a>/);
    expect(text).not.toContain("RGPD art. 9.2.a");
  });

  it("[CUM-14] in a sector with health data, also choosing by an ailment and WhatsApp's ban on health products", () => {
    const text = textOf(renderToStaticMarkup(createElement(CampaignRules, { healthData: true })));
    expect(text).toContain("RGPD art. 9.2.a");
    expect(text).toContain("productos sanitarios");
  });
});
