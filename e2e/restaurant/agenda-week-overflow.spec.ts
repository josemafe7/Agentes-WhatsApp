// [AGD-29] With more than three bookings at once, the week shows three and a «+N» that opens the list of the others,
// each with its card. The restaurant books by capacity (data/e2e-restaurante-pglite, `pnpm seed --sector=restaurante`),
// so several tables are at the same time: the owner books four groups at the same lunch time through the agent in
// «Probar» (test bookings; the simulated model books straight away with «Confirmo … a las HH:MM»,
// e2e/mocks/routes/booking.mjs), on a day of the test's own.
import { agendaPath, agendaTestDate, bookingBlocks, bookingPanel, openAgentTest, setUpBookingAgent, testTurn, WEEKDAYS } from "../support/agenda";
import { uniqueName } from "../support/names";
import { expect, test } from "../support/test";
import { mainMenu, signInThroughForm } from "../support/ui";
import { DEMO_USERS } from "../support/users";

const SECTOR_LABEL = "Restaurante";
const LUNCH_TIME = "13:30";

test("[AGD-29] more than three bookings at once: the week shows three and «+N» opens the others, each with its card", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await signInThroughForm(page, DEMO_USERS.owner);
  await expect(mainMenu(page), "the demo owner signs in to the restaurant").toBeVisible();

  const agent = await setUpBookingAgent(page, testInfo, "Reservas a la vez", { sectorLabel: SECTOR_LABEL });
  const day = agendaTestDate(testInfo, 1, WEEKDAYS.THU);
  const groups = [1, 2, 3, 4].map((index) => uniqueName(testInfo, `Mesa a la vez ${index}`));
  await openAgentTest(page, agent.agentId);
  for (const name of groups) {
    const reply = await testTurn(page, agent.agentName, `Confirmo Reserva de mesa en la Terraza el ${day} a las ${LUNCH_TIME} para 2 personas, a nombre de ${name}.`);
    expect(reply, `${name} is booked`).toContain("queda confirmada");
  }

  await page.goto(agendaPath({ view: "semana", date: day }));
  const main = page.getByRole("main");
  const more = main.getByRole("button", { name: /^Ver \d+ (reservas?|citas?) más de / });
  await expect(more.first(), "a «+N» shows next to the bookings at once").toBeVisible();

  await test.step("each of the four groups is either on the grid or in the list of a «+N»", async () => {
    const listed: string[] = [];
    for (const button of await more.all()) {
      await button.click();
      const list = page.getByRole("dialog").last();
      await expect(list).toBeVisible();
      listed.push(...(await list.getByRole("link").allTextContents()));
      await page.keyboard.press("Escape");
      await expect(list).toBeHidden();
    }
    for (const name of groups) {
      const shown = (await bookingBlocks(page, name).count()) > 0;
      const inList = listed.some((text) => text.includes(name));
      expect(shown || inList, `${name} is reachable`).toBe(true);
    }
    expect(groups.filter((name) => listed.some((text) => text.includes(name))).length, "at least one of them is behind «+N»").toBeGreaterThan(0);
  });

  await test.step("a booking of the list opens its card", async () => {
    for (const button of await more.all()) {
      await button.click();
      const list = page.getByRole("dialog").last();
      const ours = list.getByRole("link").filter({ hasText: new RegExp(groups.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")) });
      if ((await ours.count()) === 0) {
        await page.keyboard.press("Escape");
        continue;
      }
      await ours.first().click();
      await expect(bookingPanel(page)).toBeVisible();
      await expect(bookingPanel(page)).toContainText("Reserva de mesa");
      return;
    }
    throw new Error("None of the four groups was behind «+N»");
  });
});
