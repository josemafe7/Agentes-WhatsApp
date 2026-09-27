// Fase 5 acceptance with the hair salon demo: on /widget-demo the agent offers real free slots of the agenda and, once the
// customer picks one, books it; the booking shows in the agenda, made by the AI through that web chat, with links to its
// customer and its conversation ([HER-05], [HER-06], [AGD-14], [AGD-19], [AGD-21], [AGD-23]). A service that needs the
// team's confirmation stays pending and notifies the team ([AGD-22]); a booking made in «Probar» is a test booking
// ([PRU-04]). Each test sets up its own agent (booking tools on) and books on a day of its own, far from the demo's
// bookings (agendaTestDate in e2e/support/agenda.ts).
// The simulated OpenRouter books like a customer would (e2e/mocks/routes/booking.mjs): a message with a date «AAAA-MM-DD»
// → listar_servicios → consultar_disponibilidad → an offer with each slot's «[inicio]»; «Me va bien la primera» →
// crear_cita → the tool's confirmation, in the one reply of the turn.
import {
  agendaPath,
  agendaTestDate,
  bookedId,
  bookingBlocks,
  contactLinkIn,
  conversationLinkIn,
  conversationOfMessage,
  dateOf,
  deleteTestBookings,
  deleteTestBookingsFromProbar,
  expectPendingBookingNotice,
  offeredSlots,
  openAgentTest,
  openBookingPanel,
  PICK_FIRST,
  setUpBookingAgent,
  setUpBookingWebchat,
  TEST_BOOKING_CHIP,
  testBookingsButton,
  testTurn,
  timeOf,
  toolUsesOf,
  WEEKDAYS,
} from "../support/agenda";
import { authStatePath } from "../support/app";
import { widgetDemoPath } from "../support/channels";
import { holdsFor, untilWithQueue } from "../support/engine";
import { conversationPath, customerMessage } from "../support/inbox";
import { uniqueMessage, uniqueName } from "../support/names";
import { expect, test } from "../support/test";
import { escapeRegExp } from "../support/ui";
import { openVisitor, sendVisitorMessage, visitorAiReplies } from "../support/widget";

test.use({ storageState: authStatePath("owner") });

/** The «inicio» of each slot the engine suggested in one consultar_disponibilidad answer. */
function suggestedStarts(result: Record<string, unknown> | null): string[] {
  const suggested = result?.sugeridos;
  return Array.isArray(suggested) ? suggested.map((slot: { inicio?: unknown }) => String(slot.inicio)) : [];
}

test("[HER-05][HER-06][AGD-21][AGD-23][AGD-14][AGD-19][MOT-10] on /widget-demo the agent offers real free slots and books the one the customer picks: it shows in the agenda, made by the AI through that web chat, and links to its conversation", async ({
  page,
  browser,
  request,
  mock,
  openRouterKey,
}, testInfo) => {
  test.setTimeout(240_000);
  expect(openRouterKey).toBeTruthy();
  const setup = await setUpBookingWebchat(page, testInfo, "Citas web");
  const day = agendaTestDate(testInfo, 0, WEEKDAYS.WED);
  const customer = uniqueName(testInfo, "Cliente citas");
  const ask = uniqueMessage(testInfo, `Hola, quiero reservar Corte de hombre con Andrés el ${day}, a nombre de ${customer}.`);
  const demoPath = await widgetDemoPath(page, setup.channelId);
  const found = { slots: [] as string[], conversationId: "", bookingId: "" };

  const visitor = await openVisitor(browser, testInfo, demoPath);
  try {
    await sendVisitorMessage(visitor, ask);
    const replies = visitorAiReplies(visitor, setup.agentName);
    await untilWithQueue(request, async () => (await replies.count()) === 1, "the agent answers with free slots");

    await test.step("[HER-05][AGD-21] the agent offers 2 or 3 concrete slots of that day, the ones the agenda engine gave it, and books nothing yet", async () => {
      const offer = await replies.first().innerText();
      found.slots = offeredSlots(offer);
      expect(found.slots.length).toBeGreaterThanOrEqual(2);
      expect(found.slots.length).toBeLessThanOrEqual(3);
      for (const slot of found.slots) {
        expect(dateOf(slot)).toBe(day);
        expect(offer).toContain(`a las ${timeOf(slot)}`);
      }
      found.conversationId = await conversationOfMessage(mock, ask);
      const checks = (await toolUsesOf(mock, setup.agentName, "consultar_disponibilidad")).filter((use) => use.sessionId === found.conversationId);
      expect(checks).toHaveLength(1);
      expect(checks[0].args).toMatchObject({ servicio: "Corte de hombre", profesional: "Andrés", desde: day, hasta: day });
      expect(suggestedStarts(checks[0].result), "the offer is what the engine answered").toEqual(found.slots);
      expect(await toolUsesOf(mock, setup.agentName, "crear_cita"), "[AGD-21] nothing is booked before the customer confirms").toHaveLength(0);
    });

    await test.step("[AGD-23][HER-06][MOT-10] the customer picks the first one: the agent books it and confirms it in its one reply", async () => {
      await sendVisitorMessage(visitor, PICK_FIRST);
      await untilWithQueue(request, async () => (await replies.count()) === 2, "the agent confirms the booking");
      const confirmation = replies.nth(1);
      await expect(confirmation).toContainText("Corte de hombre");
      await expect(confirmation).toContainText("queda confirmada");
      await expect(confirmation).toContainText(`a las ${timeOf(found.slots[0])} con Andrés`);
      await holdsFor(request, () => replies.count(), 2, "one reply per turn, never repeated nor split");
      const creates = (await toolUsesOf(mock, setup.agentName, "crear_cita")).filter((use) => use.sessionId === found.conversationId);
      expect(creates).toHaveLength(1);
      expect(creates[0].args).toMatchObject({ servicio: "Corte de hombre", inicio: found.slots[0], profesional: "Andrés", nombre: customer });
      found.bookingId = bookedId(creates[0]);
    });
  } finally {
    await visitor.context.close();
  }

  await test.step("[AGD-14][AGD-16] the booking is in the agenda of that day with its time, customer, service and origin", async () => {
    await page.goto(agendaPath({ view: "dia", date: day }));
    const block = bookingBlocks(page, customer);
    await expect(block).toHaveCount(1);
    await expect(block).toContainText(timeOf(found.slots[0]));
    await expect(block).toContainText("Corte de hombre");
    // The block names its origin for screen readers: the AI and its channel.
    await expect(block).toHaveAccessibleName(new RegExp(`\\bIA\\b.*${escapeRegExp(setup.channelName)}`));
  });

  await test.step("[AGD-14][AGD-19] its panel: confirmed, made by the AI through the web chat, with its customer and a link to the conversation", async () => {
    const panel = await openBookingPanel(page, found.bookingId, day);
    await expect(panel).toContainText("Confirmada");
    await expect(panel).toContainText("Corte de hombre");
    await expect(panel).toContainText("Andrés");
    await expect(panel).toContainText(customer);
    // «Origen»: the AI and its channel, said once (the icon next to it is only decoration).
    await expect(panel.getByText(new RegExp(`^IA · ${escapeRegExp(setup.channelName)}$`))).toBeVisible();
    await expect(contactLinkIn(panel).first()).toBeVisible();
    const link = conversationLinkIn(panel).and(panel.locator(`[href="${conversationPath(found.conversationId)}"]`));
    await expect(link.first()).toBeVisible();
    await link.first().click();
    await expect(page).toHaveURL(new RegExp(`${conversationPath(found.conversationId)}(?:[?#].*)?$`));
    await expect(customerMessage(page, ask)).toBeVisible();
  });

  await test.step("[HER-05][AGD-09] the next customer is no longer offered the time just booked", async () => {
    const other = await openVisitor(browser, testInfo, demoPath, "segundo visitante");
    try {
      const again = uniqueMessage(testInfo, `Hola, quiero reservar Corte de hombre con Andrés el ${day}, a nombre de ${uniqueName(testInfo, "Otra clienta")}.`);
      await sendVisitorMessage(other, again);
      const replies = visitorAiReplies(other, setup.agentName);
      await untilWithQueue(request, async () => (await replies.count()) === 1, "the agent answers the second customer");
      const offered = offeredSlots(await replies.first().innerText());
      expect(offered.length).toBeGreaterThan(0);
      expect(offered).not.toContain(found.slots[0]);
    } finally {
      await other.context.close();
    }
  });
});

test("[AGD-22][AGD-23] a service that needs the team's confirmation: the agent's booking stays pending, the customer is told so and the team gets a notice that opens it", async ({
  page,
  browser,
  request,
  mock,
  openRouterKey,
}, testInfo) => {
  test.setTimeout(180_000);
  expect(openRouterKey).toBeTruthy();
  const setup = await setUpBookingWebchat(page, testInfo, "Citas keratina");
  const day = agendaTestDate(testInfo, 0, WEEKDAYS.FRI);
  const customer = uniqueName(testInfo, "Cliente keratina");
  // «Tratamiento de keratina» asks for manual confirmation in the hair salon (src/lib/sectors/peluqueria.ts).
  const ask = uniqueMessage(testInfo, `Hola, quiero reservar Tratamiento de keratina el ${day}, a nombre de ${customer}.`);
  const demoPath = await widgetDemoPath(page, setup.channelId);
  const found = { bookingId: "" };

  const visitor = await openVisitor(browser, testInfo, demoPath);
  try {
    await sendVisitorMessage(visitor, ask);
    const replies = visitorAiReplies(visitor, setup.agentName);
    await untilWithQueue(request, async () => (await replies.count()) === 1, "the agent answers with free slots");
    expect(offeredSlots(await replies.first().innerText()).length).toBeGreaterThan(0);

    await sendVisitorMessage(visitor, PICK_FIRST);
    await untilWithQueue(request, async () => (await replies.count()) === 2, "the agent answers the choice");
    // [AGD-22] The agent tells the customer that the team still has to confirm it.
    await expect(replies.nth(1)).toContainText("pendiente de confirmar");
    await expect(replies.nth(1)).not.toContainText("queda confirmada");
    const conversationId = await conversationOfMessage(mock, ask);
    const [create] = (await toolUsesOf(mock, setup.agentName, "crear_cita")).filter((use) => use.sessionId === conversationId);
    expect(create.result?.cita).toMatchObject({ servicio: "Tratamiento de keratina", estado: "pendiente" });
    found.bookingId = bookedId(create);
  } finally {
    await visitor.context.close();
  }

  await test.step("[AGD-22] the team gets a notice that opens the pending booking", async () => {
    const notice = await expectPendingBookingNotice(page, found.bookingId);
    await expect(notice).toContainText("pendiente de confirmar");
    await expect(notice).toContainText(customer);
    await notice.click();
    await expect(page).toHaveURL(new RegExp(`[?&]cita=${found.bookingId}`));
    const panel = page.getByRole("dialog").first();
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("Pendiente");
    await expect(panel).toContainText("Tratamiento de keratina");
  });
});

test("[PRU-04][HER-01] a booking made in «Probar» is a test booking: marked «Prueba» in the agenda, without customer or conversation, and the test bookings are deleted all at once", async ({
  page,
  mock,
  openRouterKey,
}, testInfo) => {
  test.setTimeout(180_000);
  expect(openRouterKey).toBeTruthy();
  const agent = await setUpBookingAgent(page, testInfo, "Citas de prueba");
  const day = agendaTestDate(testInfo, 2, WEEKDAYS.FRI);
  const customer = uniqueName(testInfo, "Cliente de prueba");

  await openAgentTest(page, agent.agentId);
  const reply = await testTurn(page, agent.agentName, `Confirmo Corte de mujer el ${day} a las 10:00, a nombre de ${customer}.`);
  expect(reply).toContain("queda confirmada");
  const creates = await toolUsesOf(mock, agent.agentName, "crear_cita");
  expect(creates).toHaveLength(1);
  expect(creates[0].result).toMatchObject({ ok: true, prueba: true });
  const bookingId = bookedId(creates[0]);

  await test.step("[PRU-04] the agenda marks it «Prueba»; it has no customer or conversation", async () => {
    await page.goto(agendaPath({ view: "dia", date: day }));
    const block = bookingBlocks(page, customer);
    await expect(block).toHaveCount(1);
    await expect(block).toContainText(TEST_BOOKING_CHIP);
    const panel = await openBookingPanel(page, bookingId, day);
    await expect(panel).toContainText(TEST_BOOKING_CHIP);
    await expect(contactLinkIn(panel)).toHaveCount(0);
    await expect(conversationLinkIn(panel)).toHaveCount(0);
  });

  await test.step("[PRU-04] «Citas de prueba» › «Borrar todas» removes the test bookings at once", async () => {
    await deleteTestBookings(page);
    await page.goto(agendaPath({ view: "dia", date: day }));
    await expect(bookingBlocks(page, customer)).toHaveCount(0);
    await expect(testBookingsButton(page)).toHaveCount(0);
  });
});

test("[PRU-04] «Borrar citas de prueba» in Probar deletes the bookings made while testing (docs/pantallas.md «Probar»)", async ({
  page,
  mock,
  openRouterKey,
}, testInfo) => {
  test.setTimeout(180_000);
  expect(openRouterKey).toBeTruthy();
  const agent = await setUpBookingAgent(page, testInfo, "Borrar pruebas");
  const day = agendaTestDate(testInfo, 3, WEEKDAYS.THU);
  const customer = uniqueName(testInfo, "Cliente de Probar");

  await openAgentTest(page, agent.agentId);
  const reply = await testTurn(page, agent.agentName, `Confirmo Corte de mujer el ${day} a las 10:00, a nombre de ${customer}.`);
  expect(reply).toContain("queda confirmada");
  const creates = await toolUsesOf(mock, agent.agentName, "crear_cita");
  expect(creates[0]?.result).toMatchObject({ ok: true, prueba: true });

  await deleteTestBookingsFromProbar(page);
  await page.goto(agendaPath({ view: "dia", date: day }));
  await expect(bookingBlocks(page, customer)).toHaveCount(0);
  await expect(testBookingsButton(page)).toHaveCount(0);
});
