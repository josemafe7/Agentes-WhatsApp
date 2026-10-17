import { describe, expect, it } from "vitest";
import { audienceFromSearchParams, campaignPath, newCampaignHref, resultsPageFromSearchParams } from "./view";

describe("the contacts of a new envío in the address [ENV-02]", () => {
  it("the ones marked, without repeating any", () => {
    expect(audienceFromSearchParams({ contactos: "a,b, a" })).toEqual({ ids: ["a", "b"] });
    expect(newCampaignHref({ ids: ["a", "b"] })).toBe("/envios/nuevo?contactos=a%2Cb");
  });

  it("or all of a filter: label and channel; without them, everyone", () => {
    expect(audienceFromSearchParams({ etiqueta: "vip", canal: "c-1" })).toEqual({ filter: { label: "vip", channelId: "c-1" } });
    expect(audienceFromSearchParams({})).toEqual({ filter: {} });
    expect(newCampaignHref({ filter: { label: "vip" } })).toBe("/envios/nuevo?etiqueta=vip");
    expect(newCampaignHref({ filter: {} })).toBe("/envios/nuevo");
  });

  it("goes and comes back the same", () => {
    for (const audience of [{ ids: ["x", "y"] }, { filter: { label: "Bonos 2026", channelId: "c-9" } }]) {
      const url = new URL(newCampaignHref(audience), "http://app.test");
      expect(audienceFromSearchParams(Object.fromEntries(url.searchParams))).toEqual(audience);
    }
  });
});

describe("the pages of the results [ENV-12]", () => {
  it("reads a positive whole page; anything else is the first", () => {
    expect(resultsPageFromSearchParams({ pagina: "3" })).toBe(3);
    for (const pagina of ["0", "-1", "2.5", "x", undefined]) expect(resultsPageFromSearchParams({ pagina })).toBe(1);
    expect(campaignPath("e-1")).toBe("/envios/e-1");
    expect(campaignPath("e-1", 2)).toBe("/envios/e-1?pagina=2");
  });
});
