// What the service form turns the typed text into before the server validates it ([AGD-04], [AJU-15]).
import { describe, expect, it } from "vitest";
import { advanceToMinutes, formatMinutes, minutesToAdvance, parseNumberField, serviceWarnings } from "./service-form";

describe("parseNumberField", () => {
  it("reads Spanish decimals and integers", () => {
    expect(parseNumberField("18,50")).toBe(18.5);
    expect(parseNumberField(" 25 ")).toBe(25);
    expect(parseNumberField("0")).toBe(0);
  });

  it("turns an empty field into null (optional price, no limit)", () => {
    expect(parseNumberField("")).toBeNull();
    expect(parseNumberField("   ")).toBeNull();
  });

  it("keeps what is not a number as written, so the server explains the error by the field", () => {
    expect(parseNumberField("veinte")).toBe("veinte");
    expect(parseNumberField("1,2,3")).toBe("1,2,3");
  });
});

describe("minimum notice [AGD-04]", () => {
  it("goes to minutes from minutes, hours or days", () => {
    expect(advanceToMinutes("90", "minutes")).toBe(90);
    expect(advanceToMinutes("2", "hours")).toBe(120);
    expect(advanceToMinutes("1", "days")).toBe(1_440);
    expect(advanceToMinutes("", "hours")).toBe(0);
    expect(advanceToMinutes("mucho", "hours")).toBe("mucho");
  });

  it("is shown back in the largest whole unit", () => {
    expect(minutesToAdvance(0)).toEqual({ amount: "0", unit: "hours" });
    expect(minutesToAdvance(90)).toEqual({ amount: "90", unit: "minutes" });
    expect(minutesToAdvance(120)).toEqual({ amount: "2", unit: "hours" });
    expect(minutesToAdvance(2_880)).toEqual({ amount: "2", unit: "days" });
  });
});

describe("formatMinutes", () => {
  it("reads durations in hours and minutes", () => {
    expect(formatMinutes(30)).toBe("30 min");
    expect(formatMinutes(60)).toBe("1 h");
    expect(formatMinutes(90)).toBe("1 h 30 min");
    expect(formatMinutes(0)).toBe("0 min");
  });
});

describe("serviceWarnings [AGD-11] [AGD-12]", () => {
  it("warns when no resource does the service: it would have no slots", () => {
    expect(serviceWarnings({ maxPeople: 1, resources: [] })).toEqual(["Sin nadie que lo haga, este servicio no tendrá huecos."]);
  });

  it("warns when the largest group does not fit in any chosen resource", () => {
    expect(serviceWarnings({ maxPeople: 8, resources: [{ capacity: 4 }, { capacity: 6 }] })).toEqual([
      "Ninguno de los elegidos admite 8 personas a la vez: los grupos de más de 6 no tendrán huecos.",
    ]);
  });

  it("says nothing when a resource fits the largest group", () => {
    expect(serviceWarnings({ maxPeople: 4, resources: [{ capacity: 1 }, { capacity: 4 }] })).toEqual([]);
  });
});
