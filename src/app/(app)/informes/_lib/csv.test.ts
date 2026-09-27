import { describe, expect, it } from "vitest";
import { csvValue, tableToCsv } from "./csv";

describe("CSV of a report table", () => {
  it("writes numbers with a decimal comma and no thousands separator", () => {
    expect(csvValue(12_345)).toBe("12345");
    expect(csvValue(37.5)).toBe("37,5");
    expect(csvValue(0.000512)).toBe("0,000512");
    expect(csvValue(0)).toBe("0");
    expect(csvValue(Number.NaN)).toBeNull();
    expect(csvValue(null)).toBeNull();
    expect(csvValue("2026-09")).toBe("2026-09");
  });

  it("starts with the UTF-8 mark and writes the headings with their units, the rows and the total row", () => {
    const csv = tableToCsv({
      columns: [
        { label: "Mes", numeric: false },
        { label: "Coste de IA", numeric: true, csvLabel: "Coste de IA (US$)" },
      ],
      rows: [[{ text: "Septiembre de 2026", value: "2026-09" }, { text: "0,0039 US$", value: 0.0039 }]],
      footer: [{ text: "Total", value: "Total" }, { text: "", value: null }],
    });
    expect(csv).toBe('﻿"Mes";"Coste de IA (US$)"\r\n"2026-09";"0,0039"\r\n"Total";""\r\n');
  });

  it("[SEG-05] never lets a reason written by the AI or a customer start a spreadsheet formula (CSV injection)", () => {
    const csv = tableToCsv({ columns: [{ label: "Motivo", numeric: false }], rows: [[{ text: "=HYPERLINK()", value: '=HYPERLINK("http://x")' }]], footer: null });
    expect(csv.split("\r\n")[1]).toBe(`"'=HYPERLINK(""http://x"")"`);
  });
});
