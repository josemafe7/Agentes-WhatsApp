// The activity log on screen ([AJU-10]): four columns that fit their place, with the details of each entry in its own
// row, under what was done, and an identifier shortened with the whole of it at hand.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { detailItems } from "../_lib/details";
import { ActivityTable, type ActivityRow } from "./activity-table";

const KB_ID = "7cce25ef-0b1d-4e6a-9c1f-3a5b7d9e1f20";

const ROWS: ActivityRow[] = [
  {
    id: "1",
    day: "9 oct 2026",
    time: "03:10",
    actorType: "system",
    who: "Sistema",
    action: "Borró datos caducados",
    actionCode: "retention.cleanup",
    target: null,
    details: detailItems({ webhookEvents: 3, conversationsDeleted: 0 }, "retention.cleanup"),
  },
  {
    id: "2",
    day: "9 oct 2026",
    time: "10:42",
    actorType: "user",
    who: "Ana García",
    action: "Añadió contenido a una base de conocimiento",
    actionCode: "knowledge.document_added",
    target: "Documento del conocimiento",
    details: detailItems({ kbId: KB_ID, sourceType: "faq" }, "knowledge.document_added"),
  },
  { id: "3", day: "9 oct 2026", time: "11:00", actorType: "user", who: "Ana García", action: "Cerró la sesión", actionCode: "auth.logout", target: "Usuario", details: [] },
];

const html = renderToStaticMarkup(createElement(ActivityTable, { rows: ROWS }));
// The table comes first and the cards after it; only one of the two shows, by the width of the page.
const [tableHtml, cardsHtml = ""] = html.split("</table>");
const tableRows = [...tableHtml.matchAll(/<tr[^>]*>.*?<\/tr>/g)].map((match) => match[0]);
const cards = cardsHtml.split(/<li class="[^"]*rounded-xl/).slice(1);
const text = (markup: string) => markup.replace(/<[^>]+>/g, "");

describe("activity log table [AJU-10]", () => {
  it("has four columns: the details are no longer one of them", () => {
    const headings = [...tableRows[0].matchAll(/<th[^>]*>(.*?)<\/th>/g)].map((match) => match[1]);
    expect(headings).toEqual(["Fecha", "Quién", "Qué hizo", "Sobre"]);
    expect(html).toContain("table-fixed");
  });

  it("each row holds who, what and every detail with its name", () => {
    const cleanup = tableRows.find((row) => row.includes("Borró datos caducados"));
    expect(cleanup).toBeDefined();
    expect(text(cleanup ?? "")).toContain("Sistema");
    // The day and, under it, the time.
    expect(text(cleanup ?? "")).toMatch(/^9 oct 202603:10/);
    expect(text(cleanup ?? "")).toContain("avisos en bruto borrados: 3 · conversaciones borradas: 0");
    // Without a target, a dash; without details, nothing more than what was done.
    expect(text(cleanup ?? "")).toMatch(/—$/);
    const logout = tableRows.find((row) => row.includes("Cerró la sesión"));
    expect(logout).not.toContain("<ul");
    expect(logout).toContain('title="auth.logout"');
  });

  it("an identifier is shortened and its tooltip has the whole of it", () => {
    const added = tableRows.find((row) => row.includes("Añadió contenido"));
    expect(added).toContain(`title="${KB_ID}"`);
    expect(text(added ?? "")).toContain("base de conocimiento: 7cce25ef… · contenido: Pregunta frecuente");
    expect(text(added ?? "")).not.toContain(KB_ID);
  });

  it("the cards of a narrow screen show the same entries, one detail per line", () => {
    expect(cards).toHaveLength(ROWS.length);
    expect(text(cards[0])).toContain("Borró datos caducados");
    expect(text(cards[0])).toContain("9 oct 2026, 03:10");
    expect(cards[0]).toContain("<li>avisos en bruto borrados: 3</li><li>conversaciones borradas: 0</li>");
    expect(cards[1]).toContain(`title="${KB_ID}"`);
  });
});
