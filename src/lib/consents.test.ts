// What a contact's consents say now ([CTO-09], [CTO-10], [WA-61], [AGD-24]): the newest record of each family decides,
// a baja counts for its whole kind of channel, and each purpose needs what the spec says.
import { describe, expect, it } from "vitest";
import { blockReason, consentStateOf, hasPermission, type ConsentRecord } from "./consents";
import type { ChannelKind, ConsentType } from "./enums";

let seq = 0;
const record = (type: ConsentType, at: string, kind: ChannelKind | null = null): ConsentRecord => ({
  id: String(++seq),
  type,
  kind,
  createdAt: new Date(at),
  givenAt: null,
  method: null,
  source: "person",
  recordedByName: null,
  note: null,
  evidence: null,
});

describe("Permisos y bajas de un contacto [CTO-09] [CTO-10]", () => {
  it("a permission is given while its newest record says so; withdrawing it takes it away", () => {
    const given = consentStateOf([record("reminders_granted", "2026-09-01T10:00:00Z")]);
    expect(hasPermission(given, "reminders")).toBe(true);
    expect(hasPermission(given, "marketing")).toBe(false);
    const withdrawn = consentStateOf([record("reminders_granted", "2026-09-01T10:00:00Z"), record("reminders_withdrawn", "2026-09-02T10:00:00Z")]);
    expect(hasPermission(withdrawn, "reminders")).toBe(false);
  });

  it("«Avisos de sus citas» se da por hecho: with no record it is given, until a withdrawal; publicidad is not (decision 0030)", () => {
    const none = consentStateOf([]);
    expect(hasPermission(none, "reminders")).toBe(true);
    expect(hasPermission(none, "marketing")).toBe(false);
    expect(hasPermission(consentStateOf([record("reminders_withdrawn", "2026-09-02T10:00:00Z")]), "reminders")).toBe(false);
    const back = consentStateOf([record("reminders_withdrawn", "2026-09-02T10:00:00Z"), record("reminders_granted", "2026-09-03T10:00:00Z")]);
    expect(hasPermission(back, "reminders")).toBe(true);
  });

  it("a reminder by WhatsApp or Telegram goes unless «Avisos de sus citas» was withdrawn; email does not look at it [AGD-24]", () => {
    const none = consentStateOf([]);
    expect(blockReason(none, "whatsapp", "reminder")).toBeNull();
    expect(blockReason(none, "telegram", "reminder")).toBeNull();
    expect(blockReason(none, "email", "reminder")).toBeNull();
    const withdrawn = consentStateOf([record("reminders_withdrawn", "2026-09-02T10:00:00Z")]);
    expect(blockReason(withdrawn, "whatsapp", "reminder")).toBe("no_reminders_permission");
    expect(blockReason(withdrawn, "telegram", "reminder")).toBe("no_reminders_permission");
    expect(blockReason(withdrawn, "email", "reminder")).toBeNull();
  });

  it("novedades y publicidad needs its permission on every channel, and a baja of it stops only that [WA-61] [CTO-10]", () => {
    const state = consentStateOf([
      record("marketing_granted", "2026-09-01T10:00:00Z"),
      record("reminders_granted", "2026-09-01T10:00:00Z"),
      record("marketing_opt_out", "2026-09-03T10:00:00Z", "whatsapp"),
    ]);
    expect(blockReason(state, "whatsapp", "marketing")).toBe("marketing_opted_out");
    expect(blockReason(state, "email", "marketing")).toBeNull();
    expect(blockReason(state, "whatsapp", "reminder")).toBeNull();
    expect(blockReason(state, "whatsapp", "conversation")).toBeNull();
    expect(blockReason(consentStateOf([]), "email", "marketing")).toBe("no_marketing_permission");
  });

  it("a baja of everything stops everything on its kind, whatever the permissions say; an alta after it lifts it [CUM-03]", () => {
    const out = consentStateOf([record("reminders_granted", "2026-09-01T10:00:00Z"), record("opt_out", "2026-09-02T10:00:00Z", "whatsapp")]);
    for (const purpose of ["conversation", "reminder", "marketing"] as const) expect(blockReason(out, "whatsapp", purpose)).toBe("opted_out");
    expect(blockReason(out, "telegram", "reminder")).toBeNull();
    const lifted = consentStateOf([record("opt_out", "2026-09-02T10:00:00Z", "whatsapp"), record("opt_in", "2026-09-03T10:00:00Z", "whatsapp")]);
    expect(blockReason(lifted, "whatsapp", "conversation")).toBeNull();
  });

  it("marking a permission does not lift a baja, and resuming marketing from WhatsApp is only a note [CTO-09] [WA-62]", () => {
    const state = consentStateOf([
      record("marketing_opt_out", "2026-09-02T10:00:00Z", "whatsapp"),
      record("marketing_granted", "2026-09-03T10:00:00Z"),
      record("marketing_resumed", "2026-09-04T10:00:00Z", "whatsapp"),
    ]);
    expect(blockReason(state, "whatsapp", "marketing")).toBe("marketing_opted_out");
  });
});
