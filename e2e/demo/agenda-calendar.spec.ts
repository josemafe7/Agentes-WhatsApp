// The agenda screen ([AGD-16], [AGD-17], [AGD-28]): the day, week, month and resources views show a booking with the
// period written out, and dragging a booking moves it only when the new time is free when saving (the server checks it
// again); a refused move leaves it where it was. The bookings come from «Probar» (test bookings, with Andrés, on a day of
// the test's own), made in a second tab while the calendar stays open in the first one. A drop always asks the server
// (src/app/(app)/agenda/_components/time-grid.tsx), which checks the place with the AI's rules.
// The drag is measured on the screen itself: the gap between the 10:00 and 11:00 bookings is one hour.
import type { Locator, Page } from "@playwright/test";
import {
  agendaPath,
  agendaTestDate,
  bookingBlocks,
  dayPeriodLabel,
  dragBlock,
  monthPeriodLabel,
  openAgentTest,
  periodHeading,
  setUpBookingAgent,
  testTurn,
  topOf,
  WEEK_PERIOD_LABEL,
  WEEKDAYS,
  type AgendaView,
} from "../support/agenda";
import { authStatePath } from "../support/app";
import { uniqueName } from "../support/names";
import { expect, test } from "../support/test";

test.use({ storageState: authStatePath("owner") });

/** Drops `block` `dy` pixels away and waits for the move it sends to be answered (the server checks the place again). */
async function dropAndSettle(page: Page, block: Locator, dy: number): Promise<void> {
  await Promise.all([page.waitForResponse((response) => response.request().method() === "POST"), dragBlock(page, block, dy)]);
}

test("[AGD-16][AGD-17][AGD-28][AGD-13] the agenda shows a booking in the day, week, month and resources views; dragged to a free time it moves, dragged to a time taken meanwhile it is refused and goes back", async ({
  page,
  context,
  openRouterKey,
}, testInfo) => {
  test.setTimeout(240_000);
  expect(openRouterKey).toBeTruthy();
  const agent = await setUpBookingAgent(page, testInfo, "Citas del calendario");
  const day = agendaTestDate(testInfo, 2, WEEKDAYS.WED);
  const ten = uniqueName(testInfo, "Cliente de las diez");
  const eleven = uniqueName(testInfo, "Cliente de las once");
  const one = uniqueName(testInfo, "Cliente de la una");

  const probar = await context.newPage();
  await openAgentTest(probar, agent.agentId);
  const book = async (time: string, name: string) => {
    const reply = await testTurn(probar, agent.agentName, `Confirmo Corte de hombre con Andrés el ${day} a las ${time}, a nombre de ${name}.`);
    expect(reply, `the ${time} booking is made`).toContain("queda confirmada");
  };
  await book("10:00", ten);
  await book("11:00", eleven);

  await test.step("[AGD-16][AGD-28] the day, week, month and resources views show the booking, each with its period written out", async () => {
    const views: [AgendaView, string | RegExp][] = [
      ["dia", dayPeriodLabel(day)],
      ["semana", WEEK_PERIOD_LABEL],
      ["mes", monthPeriodLabel(day)],
      ["recursos", dayPeriodLabel(day)],
    ];
    for (const [view, period] of views) {
      await page.goto(agendaPath({ view, date: day }));
      await expect(periodHeading(page, period), `the ${view} view names its period`).toBeVisible();
      await expect(bookingBlocks(page, ten).first(), `the ${view} view shows the booking`).toBeVisible();
    }
    await page.goto(agendaPath({ view: "dia", date: day }));
    await expect(bookingBlocks(page, ten)).toContainText("10:00");
    await expect(bookingBlocks(page, ten)).toContainText("Corte de hombre");
  });

  await test.step("[AGD-17][AGD-13] dragged onto a time booked meanwhile from another screen, the move is refused and the booking goes back", async () => {
    await page.goto(agendaPath({ view: "dia", date: day }));
    const tenBlock = bookingBlocks(page, ten);
    const elevenBlock = bookingBlocks(page, eleven);
    await expect(tenBlock).toBeVisible();
    await expect(elevenBlock).toBeVisible();
    const hour = (await topOf(elevenBlock)) - (await topOf(tenBlock));
    expect(hour, "one hour of the grid has some height").toBeGreaterThan(10);
    // 13:00 is still free on this screen when the other tab books it.
    await book("13:00", one);
    await dropAndSettle(page, tenBlock, 3 * hour);
    await expect(page.getByText("Ese hueco ya no está libre.").first(), "the server says why").toBeVisible();
    await expect(bookingBlocks(page, ten)).toContainText("10:00");
    await page.reload();
    await expect(bookingBlocks(page, ten)).toContainText("10:00");
    await expect(bookingBlocks(page, one)).toContainText("13:00");
    await expect(bookingBlocks(page, eleven)).toContainText("11:00");
  });

  await test.step("[AGD-17] dragged to a free time, it moves there and stays after reloading", async () => {
    await page.goto(agendaPath({ view: "dia", date: day }));
    const tenBlock = bookingBlocks(page, ten);
    const hour = (await topOf(bookingBlocks(page, eleven))) - (await topOf(tenBlock));
    await dropAndSettle(page, tenBlock, 2 * hour);
    await expect(bookingBlocks(page, ten)).toContainText("12:00");
    await expect
      .poll(
        async () => {
          await page.reload();
          return bookingBlocks(page, ten).innerText();
        },
        { message: "the booking now starts at 12:00" },
      )
      .toContain("12:00");
    await expect(bookingBlocks(page, eleven)).toContainText("11:00");
  });
});
