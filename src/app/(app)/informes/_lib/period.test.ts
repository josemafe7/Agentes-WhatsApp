import { describe, expect, it } from "vitest";
import { dayLabel, monthLabel, monthOptions, reportPeriodLabel, shiftMonth, shortDayLabel, shortMonthLabel } from "./period";

const range = (firstDay: string, lastDay: string) => ({ kind: "range" as const, month: null, firstDay, lastDay });

describe("[INF-01] the period in words", () => {
  it("names a month", () => {
    expect(reportPeriodLabel({ kind: "month", month: "2026-09", firstDay: "2026-09-01", lastDay: "2026-09-30" })).toBe("Septiembre de 2026");
    expect(monthLabel("2027-01")).toBe("Enero de 2027");
  });

  it("names a custom range within a month, across months and across years, and a single day", () => {
    expect(reportPeriodLabel(range("2026-09-01", "2026-09-15"))).toBe("Del 1 al 15 de septiembre de 2026");
    expect(reportPeriodLabel(range("2026-08-20", "2026-09-03"))).toBe("Del 20 de agosto al 3 de septiembre de 2026");
    expect(reportPeriodLabel(range("2025-12-01", "2026-01-15"))).toBe("Del 1 de diciembre de 2025 al 15 de enero de 2026");
    expect(reportPeriodLabel(range("2026-09-24", "2026-09-24"))).toBe("Jueves, 24 de septiembre de 2026");
  });

  it("moves month by month across years", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-09", 1)).toBe("2026-10");
  });

  it("offers the current month and the ones before it, plus the one on screen", () => {
    const options = monthOptions("2026-09", null, 3);
    expect(options).toEqual([
      { value: "2026-09", label: "Septiembre de 2026" },
      { value: "2026-08", label: "Agosto de 2026" },
      { value: "2026-07", label: "Julio de 2026" },
    ]);
    expect(monthOptions("2026-09", "2020-01", 3).map((option) => option.value)).toEqual(["2026-09", "2026-08", "2026-07", "2020-01"]);
    expect(monthOptions("2026-09", "2026-08", 3)).toHaveLength(3);
  });

  it("writes short names under the bars and longer ones in tables", () => {
    expect(shortDayLabel("2026-09-05")).toBe("5 sep");
    expect(dayLabel("2026-09-05")).toBe("5 sep 2026");
    expect(shortMonthLabel("2026-09")).toBe("sep 2026");
  });
});
