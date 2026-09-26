// The test set-up blocks real services (docs/testing.md): a test that forgot its fake fetch fails instead of
// calling OpenRouter, Meta or any other service.
import { describe, expect, it } from "vitest";

describe("tests never call real services", () => {
  it("a request to another machine fails without leaving this one", async () => {
    await expect(fetch("https://openrouter.ai/api/v1/models")).rejects.toThrow(/Prueba sin fetch simulado: .*openrouter\.ai/);
    await expect(fetch(new Request("https://graph.facebook.com/v26.0/me"))).rejects.toThrow(/graph\.facebook\.com/);
  });
});
