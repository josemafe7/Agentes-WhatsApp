// Fase 5 acceptance with the restaurant demo, its own server (data/e2e-restaurante-pglite, `pnpm seed --sector=restaurante`,
// e2e/support/env.ts): the agenda by capacity ([AGD-06], [AGD-11]). The Terraza seats 24 and a «Reserva de mesa» takes
// 1 to 8 people for 90 minutes (src/lib/sectors/restaurante.ts): groups fit at the same time while seats are left, a
// group larger than the seats left is refused with other times ([AGD-13], [HER-06]), and the capacity view shows the
// occupancy. The owner books through the agent in «Probar» (test bookings); the server has the simulated OpenRouter's
// key in its environment, and the simulated model books straight away with «Confirmo … a las HH:MM»
// (e2e/mocks/routes/booking.mjs).
import { agendaPath, agendaTestDate, bookingBlocks, offeredSlots, openAgentTest, setUpBookingAgent, testTurn, toolUsesOf, WEEKDAYS } from "../support/agenda";
import { uniqueName } from "../support/names";
import { expect, test } from "../support/test";
import { mainMenu, signInThroughForm } from "../support/ui";
import { DEMO_USERS } from "../support/users";

/** The restaurant's sector, as «Nuevo agente» names its template. */
const SECTOR_LABEL = "Restaurante";
/** Seats of the Terraza (src/lib/sectors/restaurante.ts). */
const TERRACE_SEATS = 24;
const DINNER_TIME = "21:00";
const SLOT_TAKEN = "Ese hueco ya no está libre.";

test("[AGD-06][AGD-11][AGD-13][HER-06] the restaurant respects the Terraza's capacity: groups fit while seats are left, a larger group is refused with other times, and the capacity view shows it full", async ({
  page,
  mock,
}, testInfo) => {
  test.setTimeout(240_000);
  await signInThroughForm(page, DEMO_USERS.owner);
  await expect(mainMenu(page), "the demo owner signs in to the restaurant").toBeVisible();

  const agent = await setUpBookingAgent(page, testInfo, "Reservas e2e", { sectorLabel: SECTOR_LABEL });
  const day = agendaTestDate(testInfo, 0, WEEKDAYS.SAT);
  const start = `${day}T${DINNER_TIME}`;
  const groups = { a: uniqueName(testInfo, "Grupo A"), b: uniqueName(testInfo, "Grupo B"), c: uniqueName(testInfo, "Grupo C") };
  await openAgentTest(page, agent.agentId);
  const book = (people: number, name: string) =>
    testTurn(page, agent.agentName, `Confirmo Reserva de mesa en la Terraza el ${day} a las ${DINNER_TIME} para ${people} personas, a nombre de ${name}.`);

  await test.step("[AGD-11] 8 + 8 + 6 people fit at the same time: 22 of the 24 seats", async () => {
    for (const [people, name] of [[8, groups.a], [8, groups.b], [6, groups.c]] as const) {
      expect(await book(people, name), `${people} people at ${DINNER_TIME}`).toContain("queda confirmada");
    }
  });

  await test.step("[AGD-11][AGD-13] 4 more people do not fit: refused, with other free times", async () => {
    const refused = await book(4, uniqueName(testInfo, "Grupo D"));
    expect(refused).toContain(SLOT_TAKEN);
    const alternatives = offeredSlots(refused);
    expect(alternatives.length).toBeGreaterThan(0);
    expect(alternatives).not.toContain(start);
  });

  await test.step("[AGD-11] 2 people fit exactly in the seats left; after them, the Terraza is full at that time", async () => {
    const lastTwo = uniqueName(testInfo, "Grupo E");
    expect(await book(2, lastTwo)).toContain("queda confirmada");
    expect(await book(2, uniqueName(testInfo, "Grupo F"))).toContain(SLOT_TAKEN);
  });

  await test.step("[HER-06] every booking was checked again on saving: four made, two refused, all for the Terraza at that time", async () => {
    const creates = await toolUsesOf(mock, agent.agentName, "crear_cita");
    expect(creates).toHaveLength(6);
    for (const use of creates) expect(use.args).toMatchObject({ servicio: "Reserva de mesa", profesional: "Terraza", inicio: start });
    const made = creates.filter((use) => use.result?.ok === true);
    expect(made.map((use) => use.args.personas)).toEqual([8, 8, 6, 2]);
    expect(made.reduce((sum, use) => sum + Number(use.args.personas), 0)).toBe(TERRACE_SEATS);
    expect(creates.filter((use) => use.result?.ok === false)).toHaveLength(2);
  });

  await test.step("[AGD-06][AGD-16] the capacity view shows each group's size and the Terraza full at that time", async () => {
    await page.goto(agendaPath({ view: "recursos", date: day }));
    await expect(bookingBlocks(page, groups.a)).toContainText("8 pers.");
    await expect(bookingBlocks(page, groups.c)).toContainText("6 pers.");
    await expect(page.getByRole("main").getByText(`${TERRACE_SEATS}/${TERRACE_SEATS}`).first()).toBeVisible();
  });
});
