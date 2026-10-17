import { describe, expect, it } from "vitest";
import { consentStateOf, type ConsentRecord } from "@/lib/consents";
import type { ChannelKind, ConsentType } from "@/lib/enums";
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

  it("a baja is visible while it is the newest record of its kind, of everything or of novedades y publicidad [CTO-08] [CTO-09]", () => {
    const record = (id: string, type: ConsentType, kind: ChannelKind, iso: string): ConsentRecord => ({
      id,
      type,
      kind,
      createdAt: at(iso),
      givenAt: null,
      method: null,
      source: "person",
      recordedByName: null,
      note: null,
      evidence: null,
    });
    const state = consentStateOf([
      record("1", "opt_out", "webchat", "2026-09-10T10:00:00Z"),
      record("2", "legal_acceptance", "webchat", "2026-09-18T10:00:00Z"),
      record("3", "opt_in", "webchat", "2026-09-19T10:00:00Z"),
      record("4", "opt_out", "whatsapp", "2026-09-20T10:00:00Z"),
      record("5", "marketing_opt_out", "email", "2026-09-21T10:00:00Z"),
    ]);
    expect(activeOptOuts(state)).toEqual([
      { kind: "email", scope: "marketing", since: at("2026-09-21T10:00:00Z") },
      { kind: "whatsapp", scope: "all", since: at("2026-09-20T10:00:00Z") },
    ]);
  });

  it("with no baja in force, none shows", () => {
    expect(activeOptOuts(consentStateOf([]))).toEqual([]);
  });
});
