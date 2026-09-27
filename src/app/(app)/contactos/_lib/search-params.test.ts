import { describe, expect, it } from "vitest";
import { contactPath, contactsHref, contactsQueryFromSearchParams } from "./search-params";

const CHANNEL_ID = "0b6f2c3e-1111-4c1c-9a55-6a4f0f0b3a2d";

describe("Contactos: search and filters in the URL [CTO-01]", () => {
  it("maps the Spanish URL parameters to the data filter", () => {
    expect(contactsQueryFromSearchParams({ buscar: " ana ", etiqueta: "vip", canal: CHANNEL_ID, pagina: "3" })).toEqual({
      query: { buscar: "ana", etiqueta: "vip", canal: CHANNEL_ID },
      filter: { search: "ana", label: "vip", channelId: CHANNEL_ID, page: 3 },
    });
  });

  it("without parameters there is no filter", () => {
    expect(contactsQueryFromSearchParams({})).toEqual({ query: {}, filter: { page: 1 } });
    expect(contactsQueryFromSearchParams({ buscar: "  ", etiqueta: "" })).toEqual({ query: {}, filter: { page: 1 } });
  });

  it("a page that is not a positive whole number is the first one", () => {
    for (const pagina of ["dos", "0", "-1", "1.5", ""]) expect(contactsQueryFromSearchParams({ pagina }).filter.page).toBe(1);
  });

  it("passes other values through so the data layer validates them", () => {
    expect(contactsQueryFromSearchParams({ canal: "no-es-un-id" }).filter.channelId).toBe("no-es-un-id");
    expect(contactsQueryFromSearchParams({ etiqueta: ["vip", "nueva"] }).filter.label).toBe("vip");
  });

  it("builds page links that keep the filters", () => {
    expect(contactsHref({ buscar: "ana lópez", etiqueta: "vip" }, 2)).toBe("/contactos?buscar=ana+l%C3%B3pez&etiqueta=vip&pagina=2");
    expect(contactsHref({}, 1)).toBe("/contactos");
    expect(contactsHref({ canal: CHANNEL_ID }, 1)).toBe(`/contactos?canal=${CHANNEL_ID}`);
  });

  it("links to a contact's card", () => {
    expect(contactPath(CHANNEL_ID)).toBe(`/contactos/${CHANNEL_ID}`);
  });
});
