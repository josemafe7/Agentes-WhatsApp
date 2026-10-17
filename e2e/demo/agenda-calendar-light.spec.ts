// The lighter calendar of phase 11 ([AGD-29]–[AGD-31]), on bookings of the test's own: in the week each booking shows
// its time and the customer's name, at whole words, and the stretch closed every day at midday is folded into a narrow
// band with nothing hidden in it; in the month the day says how many bookings it has and how full it is, and the whole
// day opens it. The hair salon of the demo closes from 14:00 to 16:00 on the days it opens and all day on Sundays and
// Mondays (src/lib/sectors/peluqueria.ts). The bookings come from «Probar» (test bookings, with Lucía, who works on
// Tuesdays), right before and right after the midday closure of a day of the test's own.
import { agendaPath, agendaTestDate, bookingBlocks, dayPeriodLabel, monthPeriodLabel, openAgentTest, periodHeading, setUpBookingAgent, testTurn, WEEK_PERIOD_LABEL, WEEKDAYS } from "../support/agenda";
import { authStatePath } from "../support/app";
import { uniqueName } from "../support/names";
import { expect, test } from "../support/test";

// The admin, not the owner: «Probar» counts 20 messages a minute per person (src/server/ai/limits.ts), and the
// owner's specs that run next to this one use theirs.
test.use({ storageState: authStatePath("admin") });

/** «martes, 10 de noviembre»: how the month names a day. */
function monthDayLabel(date: string): string {
  return new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${date}T00:00:00Z`));
}

test("[AGD-29][AGD-30][AGD-31] the week shows each booking's time and name at whole words and folds the midday closure; the month says how many bookings the day has and opens it", async ({ page, openRouterKey }, testInfo) => {
  test.setTimeout(180_000);
  expect(openRouterKey).toBeTruthy();
  const agent = await setUpBookingAgent(page, testInfo, "Citas del calendario ligero");
  const day = agendaTestDate(testInfo, 1, WEEKDAYS.TUE);
  const before = uniqueName(testInfo, "Rosa antes del cierre");
  const after = uniqueName(testInfo, "Pilar después del cierre");
  await openAgentTest(page, agent.agentId);
  for (const [time, name] of [["13:30", before], ["16:00", after]]) {
    const reply = await testTurn(page, agent.agentName, `Confirmo Corte de hombre con Lucía el ${day} a las ${time}, a nombre de ${name}.`);
    expect(reply, `the ${time} booking is made`).toContain("queda confirmada");
  }

  await page.goto(agendaPath({ view: "semana", date: day }));
  const main = page.getByRole("main");
  await expect(periodHeading(page, WEEK_PERIOD_LABEL)).toBeVisible();

  await test.step("[AGD-29] each booking shows its time and the first name, and no word is cut in the middle", async () => {
    for (const [time, name] of [["13:30", before], ["16:00", after]]) {
      const block = bookingBlocks(page, name);
      await expect(block).toHaveCount(1);
      const whole = (await block.getAttribute("aria-label")) ?? "";
      // What is drawn on the card, not its text for screen readers.
      const shown = (await block.locator("[aria-hidden]").first().innerText()).trim();
      expect(shown, `${name} shows its time`).toMatch(new RegExp(`^${time}`));
      expect(shown, `${name} shows the first name`).toContain(name.split(" ")[0]);
      const words = new Set(whole.split(/[\s·]+/));
      for (const word of shown.replace(/…/g, "").split(/[\s·–]+/).filter(Boolean)) {
        expect(words.has(word) || /^\d{2}:\d{2}$/.test(word), `«${word}» is a whole word of «${whole}»`).toBe(true);
      }
    }
  });

  await test.step("[AGD-30] the midday closure is a narrow band that says so, with the bookings around it in sight", async () => {
    const band = main.getByText("Cerrado de 14:00 a 16:00").locator("..");
    await expect(band).toBeVisible();
    const bandBox = await band.boundingBox();
    const beforeBox = await bookingBlocks(page, before).boundingBox();
    const afterBox = await bookingBlocks(page, after).boundingBox();
    expect(bandBox && beforeBox && afterBox, "the band and both bookings are drawn").toBeTruthy();
    // Two hours closed take less than the half-hour bookings around them.
    expect(bandBox!.height).toBeLessThan(beforeBox!.height);
    expect(beforeBox!.y + beforeBox!.height, "the 13:30 booking ends where the band starts").toBeLessThanOrEqual(bandBox!.y + 1);
    expect(afterBox!.y, "the 16:00 booking starts where the band ends").toBeGreaterThanOrEqual(bandBox!.y + bandBox!.height - 1);
  });

  await test.step("[AGD-31] the month says the day has two bookings and how full it is, and the whole day opens it", async () => {
    await page.goto(agendaPath({ view: "mes", date: day }));
    await expect(periodHeading(page, monthPeriodLabel(day))).toBeVisible();
    const ours = main.getByRole("link", { name: new RegExp(`^${monthDayLabel(day)}: 2 citas, \\d+ % ocupado$`) });
    await expect(ours).toBeVisible();
    // Closed days say so, and the salon closes on Sundays.
    await expect(main.getByRole("link", { name: /^domingo, \d{1,2} de \p{L}+: Cerrado/u }).first()).toBeVisible();
    // On the day's corner (its number): further down, its first bookings open their own cards.
    await ours.click({ position: { x: 10, y: 10 } });
    await expect(page).toHaveURL(new RegExp(`vista=dia.*fecha=${day}|fecha=${day}.*vista=dia`));
    await expect(periodHeading(page, dayPeriodLabel(day))).toBeVisible();
  });
});
