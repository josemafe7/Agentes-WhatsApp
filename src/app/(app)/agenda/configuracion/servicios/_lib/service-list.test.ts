// What each row of the services list says ([AGD-04]): the same data and words whether it is drawn in columns or stacked.
import { describe, expect, it } from "vitest";
import { serviceFacts } from "./service-list";

/** A hair salon service of the demo: one person, booked from 1 hour to 60 days ahead. */
const HAIRCUT = { durationMin: 45, bufferBeforeMin: 0, bufferAfterMin: 0, price: 22, minPeople: 1, maxPeople: 1, minAdvanceMin: 60, maxAdvanceDays: 60 };

describe("serviceFacts [AGD-04]", () => {
  it("groups the facts by column: duration, price and how it is booked", () => {
    expect(serviceFacts(HAIRCUT)).toEqual({ duration: ["45 min"], price: "22", booking: ["1 persona", "con 1 h de antelación", "hasta 60 días antes"] });
  });

  it("puts the margins with the duration, each with its side", () => {
    expect(serviceFacts({ ...HAIRCUT, durationMin: 90, bufferBeforeMin: 5, bufferAfterMin: 10 }).duration).toEqual(["1 h 30 min", "5 min antes", "10 min después"]);
    expect(serviceFacts({ ...HAIRCUT, durationMin: 150, bufferAfterMin: 15 }).duration).toEqual(["2 h 30 min", "15 min después"]);
  });

  it("writes the price as a Spanish number, without a currency, and keeps a price of zero", () => {
    expect(serviceFacts({ ...HAIRCUT, price: 18.5 }).price).toBe("18,5");
    expect(serviceFacts({ ...HAIRCUT, price: 1234.567 }).price).toBe("1234,57");
    expect(serviceFacts({ ...HAIRCUT, price: 0 }).price).toBe("0");
    expect(serviceFacts({ ...HAIRCUT, price: null }).price).toBeNull();
  });

  it("says the people as one size or as a range, and only the notices that are set", () => {
    expect(serviceFacts({ ...HAIRCUT, minPeople: 2, maxPeople: 2 }).booking[0]).toBe("2 personas");
    expect(serviceFacts({ ...HAIRCUT, minPeople: 1, maxPeople: 8, minAdvanceMin: 0, maxAdvanceDays: null }).booking).toEqual(["de 1 a 8 personas"]);
    expect(serviceFacts({ ...HAIRCUT, minAdvanceMin: 24 * 60, maxAdvanceDays: 90 }).booking).toEqual(["1 persona", "con 24 h de antelación", "hasta 90 días antes"]);
  });
});
