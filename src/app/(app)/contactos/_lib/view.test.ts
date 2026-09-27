import { describe, expect, it } from "vitest";
import { activeOptOuts, contactDisplayName, identityPhone } from "./view";

const at = (iso: string) => new Date(iso);

describe("Ficha del contacto: how it is shown [CTO-02] [CTO-08]", () => {
  it("names the contact by its name, else its email or phone, never leaving it blank", () => {
    expect(contactDisplayName({ name: "Ana", email: "ana@example.com", phone: "+34 600 111 222" })).toBe("Ana");
    expect(contactDisplayName({ name: null, email: "ana@example.com", phone: "+34 600 111 222" })).toBe("ana@example.com");
    expect(contactDisplayName({ name: "  ", email: null, phone: "+34 600 111 222" })).toBe("+34 600 111 222");
    expect(contactDisplayName({ name: null, email: null, phone: null })).toBe("Sin nombre");
  });

  it("shows an identity's phone as data, with its prefix", () => {
    expect(identityPhone("34600111222")).toBe("+34600111222");
    expect(identityPhone("+34 600 111 222")).toBe("+34 600 111 222");
    expect(identityPhone(null)).toBeNull();
  });

  it("a baja is visible while it is the latest choice on that channel [CTO-08]", () => {
    const consents = [
      { id: "4", type: "opt_out" as const, channelId: "wa", channelName: "WhatsApp Recepción", createdAt: at("2026-09-20T10:00:00Z") },
      { id: "3", type: "opt_in" as const, channelId: "web", channelName: "Chat de la web", createdAt: at("2026-09-19T10:00:00Z") },
      { id: "2", type: "legal_acceptance" as const, channelId: "web", channelName: "Chat de la web", createdAt: at("2026-09-18T10:00:00Z") },
      { id: "1", type: "opt_out" as const, channelId: "web", channelName: "Chat de la web", createdAt: at("2026-09-10T10:00:00Z") },
    ];
    expect(activeOptOuts(consents)).toEqual([{ channelId: "wa", channelName: "WhatsApp Recepción", since: at("2026-09-20T10:00:00Z") }]);
  });

  it("a baja on a channel that no longer exists still shows", () => {
    expect(activeOptOuts([{ type: "opt_out", channelId: null, channelName: null, createdAt: at("2026-09-20T10:00:00Z") }])).toEqual([
      { channelId: null, channelName: null, since: at("2026-09-20T10:00:00Z") },
    ]);
    expect(activeOptOuts([])).toEqual([]);
  });
});
