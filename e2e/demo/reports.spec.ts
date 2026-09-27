// Informes ([INF-01]–[INF-08], [CUM-11]) over the demo of the hairdresser, and who may open them ([PER-01] «Informes»).
// The demo is loaded relative to the moment the run starts ([ARR-07]) and other tests add conversations today, so exact
// figures are read on the day of the demo's hand-off answered by a person: the conversation «resuelta-persona» of
// seed/steps/conversations.ts, which starts 2 days and 5 hours before the demo was loaded and whose supervisor answers
// 2 min 1 s after the AI hands it off. No other conversation of the demo or of the tests falls on that local day.
import fs from "node:fs";
import type { Locator, Page } from "@playwright/test";
import { agentPath, createNamedAgent, sendTestMessage, testChatLog, uniqueAgentName, usd } from "../support/agents";
import { addDays, localToday, monthPeriodLabel } from "../support/agenda";
import { authStatePath } from "../support/app";
import { expect, test } from "../support/test";
import { expectRefused } from "../support/ui";

const REPORTS_PATH = "/informes";
const NO_DATA = "Todavía no hay datos de este periodo";
const HOUR_MS = 3_600_000;
/** When the demo's hand-off answered by a person was requested, before the demo was loaded. */
const DEMO_HANDOFF_AGO_MS = 53 * HOUR_MS;
/** The demo is loaded before the build: the run may have started up to this long after it. */
const RUN_SLACK_MS = 3 * HOUR_MS;
const DEMO_HANDOFF_REASON = "Pide la factura de su última cita";

/** An indicator of the row at the top (DESIGN.md «Indicadores»), by its label. */
function indicator(page: Page, label: string): Locator {
  return page.getByRole("group", { name: label, exact: true });
}

/** The figure of an indicator (its second line). */
function indicatorValue(page: Page, label: string): Locator {
  return indicator(page, label).locator("p").nth(1);
}

/** A block of the report (a chart with «Ver datos», or a table), by its title. */
function block(page: Page, title: string): Locator {
  return page.getByRole("region", { name: title, exact: true });
}

/** The period in words, above the indicators. */
function periodHeading(page: Page): Locator {
  return page.getByRole("main").getByRole("heading", { level: 2 });
}

/** «Ver datos» of a block, and its table. */
async function showData(page: Page, title: string): Promise<Locator> {
  const section = block(page, title);
  await section.getByRole("button", { name: "Ver datos" }).click();
  const table = section.getByRole("table");
  await expect(table).toBeVisible();
  return table;
}

/** The cells of the row of `table` whose first cell is `name`. */
function rowCells(table: Locator, name: string): Locator {
  return table
    .getByRole("row")
    .filter({ has: table.page().getByRole("rowheader", { name, exact: true }) })
    .getByRole("cell");
}

function reportOfDays(from: string, to: string): string {
  return `${REPORTS_PATH}?desde=${from}&hasta=${to}`;
}

/** "YYYY-MM" of the month before the one of `day`. */
function previousMonth(day: string): string {
  const [year, month] = day.split("-").map(Number);
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
}

/** Opens the report of the local day of the demo's answered hand-off and returns that day. */
async function openDemoHandoffDay(page: Page): Promise<string> {
  const now = Date.now();
  const candidates = [...new Set([localToday(new Date(now - DEMO_HANDOFF_AGO_MS)), localToday(new Date(now - DEMO_HANDOFF_AGO_MS - RUN_SLACK_MS))])];
  for (const day of candidates) {
    await page.goto(reportOfDays(day, day));
    await expect(indicator(page, "Traspasos")).toBeVisible();
    if (await block(page, "Motivos de los traspasos").getByRole("table").getByText(DEMO_HANDOFF_REASON, { exact: true }).isVisible()) return day;
  }
  throw new Error("No se encuentra el día del traspaso de la demo atendido por una persona.");
}

/** Clicks «Descargar CSV» of a block and returns the file the browser saved. */
async function downloadCsv(page: Page, title: string): Promise<{ name: string; text: string }> {
  const [download] = await Promise.all([page.waitForEvent("download"), block(page, title).getByRole("button", { name: /^Descargar CSV/ }).click()]);
  return { name: download.suggestedFilename(), text: fs.readFileSync(await download.path(), "utf8") };
}

test.describe("as the owner", () => {
  test.use({ storageState: authStatePath("owner") });

  test("[INF-01] opens on the current month of the business and moves month by month", async ({ page }) => {
    const today = localToday();
    await page.goto(REPORTS_PATH);
    await expect(periodHeading(page)).toHaveText(monthPeriodLabel(today));
    await expect(indicator(page, "Conversaciones")).toBeVisible();

    const previous = previousMonth(today);
    await page.getByRole("link", { name: "Mes anterior" }).click();
    await expect(page).toHaveURL(new RegExp(`\\?mes=${previous}$`));
    await expect(periodHeading(page)).toHaveText(monthPeriodLabel(`${previous}-01`));

    await page.getByRole("link", { name: "Mes siguiente" }).click();
    await expect(periodHeading(page)).toHaveText(monthPeriodLabel(today));
    await expect(page.getByRole("button", { name: "Mes siguiente" })).toBeDisabled();
  });

  test("[INF-01] «Otro periodo» shows a month of the list or the days chosen, both included", async ({ page }) => {
    const today = localToday();
    await page.goto(REPORTS_PATH);
    await page.getByRole("button", { name: "Otro periodo" }).click();
    await page.getByRole("combobox", { name: "Mes" }).click();
    const previous = previousMonth(today);
    await page.getByRole("option", { name: monthPeriodLabel(`${previous}-01`), exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`\\?mes=${previous}$`));
    await expect(periodHeading(page)).toHaveText(monthPeriodLabel(`${previous}-01`));

    await page.getByRole("button", { name: "Otro periodo" }).click();
    await page.getByLabel("Desde", { exact: true }).fill(addDays(today, -6));
    await page.getByLabel("Hasta", { exact: true }).fill(today);
    await page.getByRole("button", { name: "Ver estas fechas" }).click();
    await expect(page).toHaveURL(new RegExp(`\\?desde=${addDays(today, -6)}&hasta=${today}$`));
    await expect(periodHeading(page)).toHaveText(/^Del \d{1,2}/);
    // The demo has conversations of the last days.
    const conversations = Number((await indicatorValue(page, "Conversaciones").innerText()).replace(/\./g, ""));
    expect(conversations).toBeGreaterThan(0);
  });

  test("[INF-01] a period without activity says so inside each chart", async ({ page }) => {
    await page.goto(`${REPORTS_PATH}?mes=2020-01`);
    await expect(periodHeading(page)).toHaveText("Enero de 2020");
    await expect(indicatorValue(page, "Conversaciones")).toHaveText("0");
    for (const title of ["Conversaciones por canal", "Traspasos por motivo", "Primera respuesta humana", "Costes por mes"]) {
      await expect(block(page, title), `${title} has nothing to draw`).toContainText(NO_DATA);
    }
    await expect(block(page, "Motivos de los traspasos")).toContainText(NO_DATA);
  });

  test("[SEG-05] a period that is not valid is refused with a way back to this month", async ({ page }) => {
    await page.goto(reportOfDays("2026-09-10", "2026-09-01"));
    await expect(page.getByText("Algún filtro no es válido")).toBeVisible();
    await page.getByRole("link", { name: "Ver este mes" }).click();
    await expect(periodHeading(page)).toHaveText(monthPeriodLabel(localToday()));
  });

  test("[INF-02][INF-03][INF-04][INF-05][INF-07][CUM-11] the day of the demo's hand-off answered by a person in 2 minutes", async ({ page }) => {
    await openDemoHandoffDay(page);

    await test.step("[INF-02][INF-03] one WhatsApp conversation, not resolved by the AI alone: it was handed off", async () => {
      await expect(indicatorValue(page, "Conversaciones")).toHaveText("1");
      await expect(indicatorValue(page, "Resueltas por la IA")).toHaveText(/^0\s%$/);
      const table = await showData(page, "Conversaciones por canal");
      await expect(rowCells(table, "WhatsApp")).toHaveText(["WhatsApp", "1", "0", /^0\s%$/, "1", /^\d+$/]);
    });

    await test.step("[INF-04] one hand-off, started by the AI with its tool, and its reason", async () => {
      await expect(indicatorValue(page, "Traspasos")).toHaveText("1");
      await expect(indicator(page, "Traspasos")).toContainText("1 atendido por una persona");
      const table = await showData(page, "Traspasos por motivo");
      await expect(rowCells(table, "La IA, con su herramienta")).toHaveText(["1", /^100\s%$/]);
      await expect(block(page, "Motivos de los traspasos").getByRole("table")).toContainText(DEMO_HANDOFF_REASON);
    });

    await test.step("[INF-05][CUM-11] the person answered in 2 min 1 s: under 3 minutes, with the law behind it", async () => {
      await expect(indicatorValue(page, "Primera respuesta humana")).toHaveText("2 min 1 s");
      await expect(indicatorValue(page, "Atendidos en menos de 3 min")).toHaveText(/^100\s%$/);
      await expect(indicator(page, "Atendidos en menos de 3 min")).toContainText("1 de 1 traspaso");
      const response = block(page, "Primera respuesta humana");
      await expect(response).toContainText("Ley 10/2025");
      await expect(response).toContainText("95 %");
      const table = await showData(page, "Primera respuesta humana");
      await expect(table).toContainText("2 min 1 s");
    });

    await test.step("[INF-07] the AI cost OpenRouter reported for that day, and WhatsApp's estimate", async () => {
      await expect(indicatorValue(page, "Coste de IA")).toHaveText(usd("0,00025"));
      await expect(indicatorValue(page, "WhatsApp (estimado)")).toHaveText(usd("0,00"));
      await expect(indicator(page, "WhatsApp (estimado)")).toContainText("Coste estimado");
      const table = await showData(page, "Costes por mes");
      await expect(table.getByRole("columnheader", { name: "WhatsApp (estimado)" })).toBeVisible();
    });
  });

  test("[INF-02] «Descargar CSV» saves the table on screen, as a Spanish spreadsheet reads it", async ({ page }) => {
    const day = await openDemoHandoffDay(page);
    const file = await downloadCsv(page, "Conversaciones por canal");
    expect(file.name).toBe(`informe-conversaciones-por-canal-${day}_${day}.csv`);
    const lines = file.text.split("\r\n");
    expect(lines[0]).toBe('﻿"Canal";"Tipo";"Conversaciones";"Resueltas por la IA";"% resuelto por la IA";"Traspasos";"Citas creadas por la IA"');
    expect(lines).toContainEqual(expect.stringMatching(/^"WhatsApp";"WhatsApp";"1";"0";"0";"1";"\d+"$/));
  });

  test("[INF-02] choosing a channel keeps the period and shows only that channel", async ({ page }) => {
    const day = await openDemoHandoffDay(page);
    await page.getByRole("combobox", { name: "Canal" }).click();
    await page.getByRole("option", { name: "WhatsApp: WhatsApp", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`\\?desde=${day}&hasta=${day}&canal=[0-9a-f-]{36}$`));
    await expect(indicator(page, "Coste de IA")).toContainText("Solo el de las conversaciones de este canal");
    const table = await showData(page, "Conversaciones por canal");
    await expect(table.getByRole("rowheader")).toHaveText(["WhatsApp", "Total"]);
  });

  test("[INF-08] «Probar agente» adds no conversation, and its AI cost is shown apart", async ({ page, openRouterKey }, testInfo) => {
    expect(openRouterKey).toBeTruthy();
    const today = localToday();
    await page.goto(reportOfDays(today, today));
    const before = await indicatorValue(page, "Conversaciones").innerText();

    const agentId = await createNamedAgent(page, uniqueAgentName(testInfo, "Agente de informes"));
    await page.goto(agentPath(agentId, "probar"));
    await sendTestMessage(page, "¿Qué horario tenéis?");
    await expect(testChatLog(page)).toContainText(usd("0,00031"));

    await page.goto(reportOfDays(today, today));
    await expect(indicatorValue(page, "Conversaciones")).toHaveText(before);
    await expect(indicator(page, "Coste de IA")).toContainText("en «Probar agente»");
  });
});

test.describe("[PER-01] «Informes»: owner, admin, supervisor and viewer; never the agent", () => {
  for (const role of ["admin", "supervisor", "viewer"] as const) {
    test.describe(`as the demo ${role}`, () => {
      test.use({ storageState: authStatePath(role) });

      test(`[PER-01][PER-03] the ${role} reads the reports and downloads a table`, async ({ page }) => {
        await page.goto(REPORTS_PATH);
        await expect(periodHeading(page)).toHaveText(monthPeriodLabel(localToday()));
        await expect(indicator(page, "Resueltas por la IA")).toBeVisible();
        const file = await downloadCsv(page, "Costes por mes");
        expect(file.name).toMatch(/^informe-costes-por-mes-\d{4}-\d{2}\.csv$/);
        expect(file.text.split("\r\n")[0]).toBe('﻿"Mes";"Coste de IA (US$)";"IA en «Probar agente» (US$)";"WhatsApp estimado (US$)";"Mensajes sin tarifa"');
      });
    });
  }

  test.describe("as the demo agent", () => {
    test.use({ storageState: authStatePath("agent") });

    test("[PER-01][SEG-04] the agent cannot open Informes, not even by its address", async ({ page }) => {
      await expectRefused(page, REPORTS_PATH);
      await expectRefused(page, `${REPORTS_PATH}?mes=2026-09`);
    });
  });
});
