// The Instagram wizard as it first renders ([IG-01]): what to prepare in Meta with its official pages, and the form
// whose token and keys are password fields that never come back filled.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { INSTAGRAM_META_LINKS } from "../_lib/steps";
import { InstagramWizard } from "./instagram-wizard";

const render = (props: Partial<Parameters<typeof InstagramWizard>[0]> = {}) =>
  renderToStaticMarkup(createElement(InstagramWizard, { agents: [{ id: crypto.randomUUID(), name: "Recepción" }], existing: null, publicUrl: true, timezone: "Europe/Madrid", ...props }));

describe("the Instagram wizard [IG-01]", () => {
  it("starts with what to prepare in Meta's panel, linking its official pages", () => {
    const html = render();
    expect(html).toContain("Prepara tu app de Meta");
    for (const link of Object.values(INSTAGRAM_META_LINKS).filter((link) => link !== INSTAGRAM_META_LINKS.webhooks)) expect(html).toContain(`href="${link}"`);
    expect(html).toContain("«Generate token»");
    expect(html).toContain("«Instagram app secret»");
    expect(html).not.toContain("La app no tiene una dirección pública con HTTPS");
  });

  it("without a public HTTPS address it warns that Meta cannot reach the app until it is published", () => {
    expect(render({ publicUrl: false })).toContain("La app no tiene una dirección pública con HTTPS");
  });

  it("connecting an account again opens on the form: token and keys are empty password fields", () => {
    const html = render({ existing: { id: crypto.randomUUID(), name: "Instagram Peluquería", activeAgentId: null, aiEnabled: true } });
    expect(html).toContain("Conectar la cuenta");
    for (const name of ["accessToken", "appSecret", "metaAppSecret"]) {
      const field = new RegExp(`<input[^>]*name="${name}"[^>]*>`).exec(html)?.[0] ?? "";
      expect(field, name).toContain('type="password"');
      expect(field, name).not.toContain("value=");
    }
    expect(html).toContain("Clave secreta de Instagram");
    expect(html).toContain("Clave secreta de la app de Meta (opcional)");
    expect(html).toContain('value="Instagram Peluquería"');
  });
});
