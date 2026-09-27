// What the Informes screen shows and exports from a report ([INF-02]–[INF-07], [CUM-11]): indicators, chart data and
// tables, from a hand-made report of September 2026.
import { describe, expect, it } from "vitest";
import type { Report, ResponseBucket } from "@/data/reports";
import { tableToCsv } from "./csv";
import { buildReportTable, csvFileName, REPORT_TABLE_KEYS } from "./tables";
import { channelBars, costBars, emptyCharts, hasActivity, originBars, reportKpis, responseBars } from "./view";

const texts = (cells: { text: string }[]) => cells.map((cell) => cell.text.replace(/ /g, " "));

function buckets(overrides: Record<string, Partial<ResponseBucket>>): ResponseBucket[] {
  return Array.from({ length: 30 }, (_, index) => {
    const key = `2026-09-${String(index + 1).padStart(2, "0")}`;
    return { key, handoffs: 0, answered: 0, withinTarget: 0, medianMs: null, ...overrides[key] };
  });
}

function sampleReport(overrides: Partial<Report> = {}): Report {
  return {
    period: {
      kind: "month",
      month: "2026-09",
      firstDay: "2026-09-01",
      lastDay: "2026-09-30",
      days: 30,
      start: new Date("2026-08-31T22:00:00Z"),
      end: new Date("2026-09-30T22:00:00Z"),
      timezone: "Europe/Madrid",
    },
    channelId: null,
    channels: [
      { id: "c-web", name: "Chat de la web", type: "webchat" },
      { id: "c-mail", name: "Correo", type: "email_gmail" },
      { id: "c-wa", name: "WhatsApp", type: "whatsapp" },
    ],
    terminology: { booking: "cita", bookings: "citas", resource: "profesional", resources: "profesionales", customer: "cliente" },
    conversations: { total: 8, resolvedByAi: 3 },
    byChannel: [
      { id: "c-wa", name: "WhatsApp", type: "whatsapp", conversations: 5, resolvedByAi: 2, handoffs: 2, aiBookings: 3 },
      { id: "c-web", name: "Chat de la web", type: "webchat", conversations: 3, resolvedByAi: 1, handoffs: 1, aiBookings: 0 },
      { id: "c-mail", name: "Correo", type: "email_gmail", conversations: 0, resolvedByAi: 0, handoffs: 0, aiBookings: 0 },
    ],
    handoffs: {
      total: 3,
      byOrigin: [
        { origin: "ai_tool", count: 2 },
        { origin: "human", count: 1 },
      ],
      reasons: [
        { origin: "ai_tool", reason: "Quiere hablar con una persona", count: 2 },
        { origin: "human", reason: "", count: 1 },
      ],
      otherReasons: 0,
    },
    firstResponse: {
      answered: 2,
      closedWithoutAnswer: 0,
      waiting: 1,
      withinTarget: 1,
      counted: 3,
      medianMs: 150_000,
      p90Ms: 600_000,
      granularity: "day",
      buckets: buckets({
        "2026-09-20": { handoffs: 2, answered: 2, withinTarget: 1, medianMs: 150_000 },
        "2026-09-27": { handoffs: 1 },
      }),
    },
    bookings: { createdByAi: 3 },
    costs: {
      aiUsd: 0.0039,
      aiTestUsd: 0.0007,
      whatsappUsd: 0.0456,
      whatsappUnpriced: 1,
      months: [
        { month: "2026-08", aiUsd: 0.004, aiTestUsd: 0, whatsappUsd: 0.03, whatsappUnpriced: 0 },
        { month: "2026-09", aiUsd: 0.0039, aiTestUsd: 0.0007, whatsappUsd: 0.0456, whatsappUnpriced: 1 },
      ],
    },
    ...overrides,
  };
}

describe("indicators", () => {
  it("[INF-02] [INF-03] [INF-04] [INF-05] [INF-06] [INF-07] [CUM-11] one indicator per figure, in Spanish", () => {
    const spaces = (value: string) => value.replace(/ /g, " ");
    const kpis = Object.fromEntries(reportKpis(sampleReport()).map((kpi) => [kpi.key, { ...kpi, value: spaces(kpi.value), caption: spaces(kpi.caption) }]));
    expect(kpis.conversations).toMatchObject({ label: "Conversaciones", value: "8" });
    expect(kpis["resolved-by-ai"]).toMatchObject({ label: "Resueltas por la IA", value: "37,5 %", caption: "3 de 8, sin traspaso ni personas" });
    expect(kpis.handoffs).toMatchObject({ label: "Traspasos", value: "3", caption: "2 atendidos por una persona" });
    expect(kpis["first-response"]).toMatchObject({ label: "Primera respuesta humana", value: "2 min 30 s", caption: "Mediana · el 90 % en 10 min o menos" });
    expect(kpis["within-target"]).toMatchObject({ label: "Atendidos en menos de 3 min", value: "33,3 %", caption: "1 de 3 traspasos" });
    expect(kpis["ai-bookings"]).toMatchObject({ label: "Citas creadas por la IA", value: "3" });
    expect(kpis["ai-cost"]).toMatchObject({ label: "Coste de IA", value: "0,0039 US$", caption: "Según OpenRouter · además, 0,0007 US$ en «Probar agente»" });
    expect(kpis["whatsapp-cost"]).toMatchObject({ label: "WhatsApp (estimado)", value: "0,05 US$", caption: "Coste estimado · 1 mensaje sin tarifa, sin estimar" });
  });

  it("[AGD-01] uses the business's word for bookings", () => {
    const kpis = reportKpis(sampleReport({ terminology: { booking: "reserva", bookings: "reservas", resource: "mesa", resources: "mesas", customer: "comensal" } }));
    expect(kpis.find((kpi) => kpi.key === "ai-bookings")?.label).toBe("Reservas creadas por la IA");
  });

  it("[CUM-11] says when hand-offs may still be answered in time, and shows «—» for shares of nothing", () => {
    const report = sampleReport({
      conversations: { total: 0, resolvedByAi: 0 },
      handoffs: { total: 1, byOrigin: [{ origin: "ai_tool", count: 1 }], reasons: [], otherReasons: 1 },
      firstResponse: { ...sampleReport().firstResponse, answered: 0, withinTarget: 0, counted: 0, waiting: 1, medianMs: null, p90Ms: null },
    });
    const kpis = Object.fromEntries(reportKpis(report).map((kpi) => [kpi.key, kpi]));
    expect(kpis["resolved-by-ai"]).toMatchObject({ value: "—", caption: "Sin conversaciones en el periodo" });
    expect(kpis["first-response"]).toMatchObject({ value: "—", caption: "Ningún traspaso atendido en el periodo" });
    expect(kpis["within-target"]).toMatchObject({ value: "—", caption: "1 traspaso aún a tiempo" });
  });

  it("[INF-07] with a channel chosen, the AI cost is only its conversations'", () => {
    const kpis = reportKpis(sampleReport({ channelId: "c-wa" }));
    expect(kpis.find((kpi) => kpi.key === "ai-cost")?.caption).toBe("Solo el de las conversaciones de este canal");
  });
});

describe("tables («Ver datos» and CSV)", () => {
  it("[INF-02] [INF-03] conversations by channel, with the share resolved by the AI and a total row", () => {
    const table = buildReportTable(sampleReport(), "canales");
    expect(table.title).toBe("Conversaciones por canal");
    expect(table.columns.map((column) => column.label)).toEqual([
      "Canal",
      "Tipo",
      "Conversaciones",
      "Resueltas por la IA",
      "% resuelto por la IA",
      "Traspasos",
      "Citas creadas por la IA",
    ]);
    expect(texts(table.rows[0])).toEqual(["WhatsApp", "WhatsApp", "5", "2", "40 %", "2", "3"]);
    expect(texts(table.rows[2])).toEqual(["Correo", "Correo · Gmail", "0", "0", "—", "0", "0"]);
    expect(table.footer && texts(table.footer)).toEqual(["Total", "", "8", "3", "37,5 %", "3", "3"]);
    expect(table.rows[0].map((cell) => cell.value)).toEqual(["WhatsApp", "WhatsApp", 5, 2, 40, 2, 3]);
    expect(table.rows[2][4].value).toBeNull();
  });

  it("[INF-04] hand-offs by what started them, and their reasons with the rest added up", () => {
    const origins = buildReportTable(sampleReport(), "traspasos");
    expect(origins.rows.map(texts)).toEqual([
      ["La IA, con su herramienta", "2", "66,7 %"],
      ["Una persona, a mano", "1", "33,3 %"],
    ]);
    expect(origins.footer && texts(origins.footer)).toEqual(["Total", "3", "100 %"]);

    const report = sampleReport();
    const reasons = buildReportTable({ ...report, handoffs: { ...report.handoffs, total: 5, otherReasons: 2 } }, "motivos");
    expect(reasons.rows.map(texts)).toEqual([
      ["Quiere hablar con una persona", "La IA, con su herramienta", "2"],
      ["Sin motivo", "Una persona, a mano", "1"],
      ["Otros motivos", "", "2"],
    ]);
    expect(reasons.footer && texts(reasons.footer)).toEqual(["Total", "", "5"]);
  });

  it("[INF-05] first human answer by day, only the days with hand-offs, the median in minutes for spreadsheets", () => {
    const table = buildReportTable(sampleReport(), "primera-respuesta");
    expect(table.columns.map((column) => column.csvLabel ?? column.label)).toEqual(["Día", "Traspasos", "Atendidos por una persona", "Mediana (minutos)", "En menos de 3 min"]);
    expect(table.rows.map(texts)).toEqual([
      ["20 sep 2026", "2", "2", "2 min 30 s", "1"],
      ["27 sep 2026", "1", "0", "—", "0"],
    ]);
    expect(table.rows[0].map((cell) => cell.value)).toEqual(["2026-09-20", 2, 2, 2.5, 1]);
    expect(table.footer && texts(table.footer)).toEqual(["Total", "3", "2", "2 min 30 s", "1"]);
  });

  it("[INF-07] costs by month in US$, WhatsApp estimated, with the messages without a rate", () => {
    const table = buildReportTable(sampleReport(), "costes");
    expect(table.columns.map((column) => column.label)).toEqual(["Mes", "Coste de IA", "IA en «Probar agente»", "WhatsApp (estimado)", "Mensajes sin tarifa"]);
    expect(table.rows.map(texts)).toEqual([
      ["Agosto de 2026", "0,004 US$", "0,00 US$", "0,03 US$", "0"],
      ["Septiembre de 2026", "0,0039 US$", "0,0007 US$", "0,05 US$", "1"],
    ]);
    expect(table.footer?.[1].value).toBeCloseTo(0.0079, 10);
    const csv = tableToCsv(table);
    expect(csv.split("\r\n").slice(0, 3)).toEqual([
      '﻿"Mes";"Coste de IA (US$)";"IA en «Probar agente» (US$)";"WhatsApp estimado (US$)";"Mensajes sin tarifa"',
      '"2026-08";"0,004";"0";"0,03";"0"',
      '"2026-09";"0,0039";"0,0007";"0,0456";"1"',
    ]);
  });

  it("names each file after its table and period", () => {
    const { period } = sampleReport();
    expect(csvFileName("canales", period)).toBe("informe-conversaciones-por-canal-2026-09.csv");
    expect(csvFileName("costes", { kind: "range", month: null, firstDay: "2026-09-01", lastDay: "2026-09-15" })).toBe("informe-costes-por-mes-2026-09-01_2026-09-15.csv");
    expect(REPORT_TABLE_KEYS).toHaveLength(5);
  });
});

describe("charts", () => {
  it("[INF-02] [INF-04] [INF-05] [INF-07] give each chart its bars, in words", () => {
    const report = sampleReport();
    expect(channelBars(report)[0]).toEqual({ name: "WhatsApp", conversations: 5, resolvedByAi: 2, colorKey: "whatsapp" });
    expect(channelBars(report)[2].colorKey).toBe("email");
    expect(originBars(report)).toEqual([
      { label: "La IA, con su herramienta", count: 2 },
      { label: "Una persona, a mano", count: 1 },
    ]);
    const response = responseBars(report);
    expect(response).toHaveLength(30);
    expect(response[19]).toEqual({ label: "20 sep", fullLabel: "20 sep 2026", minutes: 2.5, answered: 2 });
    expect(response[0].minutes).toBeNull();
    expect(costBars(report)).toEqual([
      { label: "ago 2026", fullLabel: "Agosto de 2026", ai: 0.004, whatsapp: 0.03 },
      { label: "sep 2026", fullLabel: "Septiembre de 2026", ai: 0.0039, whatsapp: 0.0456 },
    ]);
  });

  it("[INF-01] tell which charts have nothing to draw in the period", () => {
    const empty = sampleReport({
      conversations: { total: 0, resolvedByAi: 0 },
      handoffs: { total: 0, byOrigin: [], reasons: [], otherReasons: 0 },
      firstResponse: { ...sampleReport().firstResponse, answered: 0, counted: 0, withinTarget: 0, waiting: 0, medianMs: null, p90Ms: null, buckets: buckets({}) },
      bookings: { createdByAi: 0 },
      costs: { aiUsd: 0, aiTestUsd: 0, whatsappUsd: 0, whatsappUnpriced: 0, months: [{ month: "2026-09", aiUsd: 0, aiTestUsd: 0, whatsappUsd: 0, whatsappUnpriced: 0 }] },
    });
    expect(emptyCharts(empty)).toEqual({ channels: true, origins: true, response: "no-handoffs", costs: true });
    expect(hasActivity(empty)).toBe(false);
    expect(emptyCharts(sampleReport())).toEqual({ channels: false, origins: false, response: null, costs: false });
    expect(hasActivity(sampleReport())).toBe(true);
    const unanswered = sampleReport({ firstResponse: { ...sampleReport().firstResponse, answered: 0, medianMs: null, p90Ms: null } });
    expect(emptyCharts(unanswered).response).toBe("no-answers");
  });
});
