// Instagram's 24 h window in the inbox ([BAN-18], [IG-04]): pure.
import { describe, expect, it } from "vitest";
import { describeInstagramWindow, INSTAGRAM_NEVER_WROTE_TEXT, INSTAGRAM_WINDOW_CLOSED_TEXT } from "./presentation";

const TZ = "Europe/Madrid";
const NOW = new Date("2026-10-16T10:00:00Z");
const HOUR_MS = 3_600_000;

describe("Instagram's 24 h window in the inbox [BAN-18] [IG-04]", () => {
  it("open: until when and how long is left", () => {
    const closesAt = new Date(NOW.getTime() + 3 * HOUR_MS + 12 * 60_000);
    expect(describeInstagramWindow({ open: true, closesAt }, NOW, TZ)).toEqual({ state: "open", closesAt, text: "Puedes responder hasta 15:12 · quedan 3 h 12 min" });
  });

  it("closed: more than 24 hours since the customer's last message, nothing can be sent until they write again", () => {
    const closedAt = new Date(NOW.getTime() - HOUR_MS);
    expect(describeInstagramWindow({ open: false, closesAt: closedAt }, NOW, TZ)).toEqual({
      state: "closed",
      text: "Han pasado más de 24 horas desde el último mensaje del cliente: Instagram no deja responder hasta que vuelva a escribir.",
      detail: "Se cerró el 16 oct 2026, 11:00. Se abre de nuevo cuando el cliente escriba.",
    });
    expect(INSTAGRAM_WINDOW_CLOSED_TEXT).toMatch(/no deja responder/);
  });

  it("closes on time with the screen's clock, even if the server said open", () => {
    const closesAt = new Date(NOW.getTime() - 60_000);
    expect(describeInstagramWindow({ open: true, closesAt }, NOW, TZ).state).toBe("closed");
  });

  it("a customer who never wrote cannot be written to first", () => {
    expect(describeInstagramWindow({ open: false, closesAt: null }, NOW, TZ)).toEqual({ state: "closed", text: INSTAGRAM_NEVER_WROTE_TEXT, detail: null });
  });
});
