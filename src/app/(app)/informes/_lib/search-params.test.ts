import { describe, expect, it } from "vitest";
import { parseReportsQuery, reportFilterOf, reportsHref, withChannel, withMonth } from "./search-params";

const CHANNEL = "3f2b7c1e-6a4d-4c1b-9d7e-2a1b3c4d5e6f";

describe("[INF-01] the period and the channel in the URL", () => {
  it("reads nothing as the current month of every channel", () => {
    expect(parseReportsQuery({})).toEqual({});
    expect(reportsHref({})).toBe("/informes");
  });

  it("reads a month and a channel, trimmed, the first value of each", () => {
    expect(parseReportsQuery({ mes: " 2026-09 ", canal: [CHANNEL, "otro"] })).toEqual({ month: "2026-09", channelId: CHANNEL });
  });

  it("prefers the days of a custom range to a month, and keeps a half range for the data layer to refuse", () => {
    expect(parseReportsQuery({ mes: "2026-09", desde: "2026-09-01", hasta: "2026-09-15" })).toEqual({ from: "2026-09-01", to: "2026-09-15" });
    expect(parseReportsQuery({ desde: "2026-09-01", mes: "2026-08" })).toEqual({ from: "2026-09-01" });
    expect(parseReportsQuery({ mes: "" })).toEqual({});
  });

  it("writes links in Spanish and back", () => {
    const query = { from: "2026-09-01", to: "2026-09-15", channelId: CHANNEL };
    const href = reportsHref(query);
    expect(href).toBe(`/informes?desde=2026-09-01&hasta=2026-09-15&canal=${CHANNEL}`);
    expect(parseReportsQuery(Object.fromEntries(new URL(href, "http://localhost").searchParams))).toEqual(query);
    expect(reportsHref({ month: "2026-08" })).toBe("/informes?mes=2026-08");
  });

  it("changes the channel keeping the period, and the month keeping the channel", () => {
    expect(withChannel({ month: "2026-09", channelId: CHANNEL }, null)).toEqual({ month: "2026-09" });
    expect(withChannel({ from: "2026-09-01", to: "2026-09-02" }, CHANNEL)).toEqual({ from: "2026-09-01", to: "2026-09-02", channelId: CHANNEL });
    expect(withMonth({ from: "2026-09-01", to: "2026-09-02", channelId: CHANNEL }, "2026-07")).toEqual({ month: "2026-07", channelId: CHANNEL });
    expect(withMonth({ month: "2026-07" }, null)).toEqual({});
  });

  it("gives the data layer exactly what the URL said", () => {
    expect(reportFilterOf({ month: "2026-09", channelId: CHANNEL })).toEqual({ month: "2026-09", channelId: CHANNEL });
  });
});
