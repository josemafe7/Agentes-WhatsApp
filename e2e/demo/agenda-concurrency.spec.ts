// Fase 5 acceptance, no double bookings ([AGD-13], [HER-06]): two customers want the last free slot of a day and confirm it
// at the same moment. Both go through the agent's tool (crear_cita), each in its own «Probar» (the owner's and the
// administrator's, two requests to the server at once): the booking service checks the slot again inside its transaction,
// so exactly one booking is made and the other customer hears «Ese hueco ya no está libre» with other free slots.
// «Arreglo de barba» (20 minutes) is done only by Andrés, whose afternoon ends at 20:00 (src/lib/sectors/peluqueria.ts):
// from 19:30 on, the engine has one slot left in the day.
import { agendaPath, agendaTestDate, bookingBlocks, dateOf, offeredSlots, openAgentTest, PICK_FIRST, setUpBookingAgent, testTurn, toolUsesOf, WEEKDAYS } from "../support/agenda";
import { authStatePath, newPersonContext } from "../support/app";
import { uniqueName } from "../support/names";
import { clientIpFor, expect, test } from "../support/test";
import { escapeRegExp } from "../support/ui";

test.use({ storageState: authStatePath("owner") });

const SLOT_TAKEN = "Ese hueco ya no está libre.";

test("[AGD-13][HER-06] two customers confirm the last free slot of the day at the same time: one booking is made and the other hears «Ese hueco ya no está libre» with other slots", async ({
  page,
  browser,
  mock,
  openRouterKey,
}, testInfo) => {
  test.setTimeout(180_000);
  expect(openRouterKey).toBeTruthy();
  const agent = await setUpBookingAgent(page, testInfo, "Citas a la vez");
  const day = agendaTestDate(testInfo, 1, WEEKDAYS.THU);
  const ana = uniqueName(testInfo, "Ana a la vez");
  const bruno = uniqueName(testInfo, "Bruno a la vez");
  const ask = (name: string) => `¿Qué huecos hay para Arreglo de barba con Andrés el ${day} a partir de las 19:30? Es a nombre de ${name}.`;

  const admin = await newPersonContext(browser, testInfo, {
    clientIp: clientIpFor(`${testInfo.testId}:${testInfo.retry}:admin`),
    storageState: authStatePath("admin"),
  });
  try {
    const second = await admin.newPage();
    await openAgentTest(page, agent.agentId);
    await openAgentTest(second, agent.agentId);

    const slot = await test.step("both are offered the same slot, the only one left that day", async () => {
      const [offerA, offerB] = [await testTurn(page, agent.agentName, ask(ana)), await testTurn(second, agent.agentName, ask(bruno))];
      const slots = offeredSlots(offerA);
      expect(slots, "one slot is left from 19:30").toHaveLength(1);
      expect(dateOf(slots[0])).toBe(day);
      expect(offeredSlots(offerB)).toEqual(slots);
      return slots[0];
    });

    const replies = await test.step("both confirm it at the same moment", async () =>
      Promise.all([testTurn(page, agent.agentName, PICK_FIRST), testTurn(second, agent.agentName, PICK_FIRST)]),
    );

    await test.step("[AGD-13] only one gets it; the other hears it is taken and gets other free slots", async () => {
      expect(replies.filter((reply) => reply.includes("queda confirmada")), "exactly one booking is confirmed").toHaveLength(1);
      const refused = replies.find((reply) => reply.includes(SLOT_TAKEN));
      expect(refused, `the other reply says «${SLOT_TAKEN}»`).toBeDefined();
      const alternatives = offeredSlots(refused ?? "");
      expect(alternatives.length).toBeGreaterThan(0);
      expect(alternatives).not.toContain(slot);
    });

    await test.step("[HER-06] both tool calls asked for that slot and checked it again on saving: one booked, one refused", async () => {
      const creates = await toolUsesOf(mock, agent.agentName, "crear_cita");
      expect(creates).toHaveLength(2);
      for (const use of creates) expect(use.args.inicio).toBe(slot);
      expect(creates.filter((use) => use.result?.ok === true)).toHaveLength(1);
      expect(creates.filter((use) => use.result?.ok === false && use.result.error === SLOT_TAKEN)).toHaveLength(1);
    });

    await test.step("[AGD-13] the agenda of that day has one booking for that slot", async () => {
      await page.goto(agendaPath({ view: "dia", date: day }));
      await expect(bookingBlocks(page, new RegExp(`${escapeRegExp(ana)}|${escapeRegExp(bruno)}`))).toHaveCount(1);
    });
  } finally {
    await admin.close();
  }
});
