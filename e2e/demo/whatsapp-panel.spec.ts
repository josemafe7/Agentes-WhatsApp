// The panel of a WhatsApp number ([WA-26]–[WA-29], [CAN-15], [CAN-16]): its traffic lights from Meta's answers, what
// happens when Meta reports a problem (account notice → a new check → red light, «Error» and a notice for the owner),
// and «Desconectar», which erases the credentials, leaves Meta when confirmed and keeps the history. Each test connects a
// number of its own through the wizard.
import { authStatePath } from "../support/app";
import { runQueue } from "../support/engine";
import { openConversationWith, openNotifications, searchInbox } from "../support/inbox";
import { uniqueMessage } from "../support/names";
import { expect, test } from "../support/test";
import { clickAndWaitForPost } from "../support/ui";
import { channelPanelPath, connectWhatsAppNumber, disableChannelQuietly, disconnectNumber, expectChannelState, expectLight, healthLight, revalidateNumber } from "../support/whatsapp";
import {
  deliverWebhook,
  graphPath,
  META,
  META_TOKENS,
  metaCalls,
  numberAsMetaShowsIt,
  postWebhook,
  testCustomer,
  testNumber,
  webhookBody,
} from "../support/whatsapp-meta";

test.use({ storageState: authStatePath("owner") });

test("[WA-26][WA-27][WA-29][CAN-15] the panel's traffic lights come from Meta; after Meta's notice the new check turns them red, the channel shows «Error» and the owner is told", async ({
  page,
  request,
  mock,
}, testInfo) => {
  test.setTimeout(180_000);
  const number = testNumber(testInfo, "WhatsApp semáforos");
  const customer = testCustomer(testInfo, "Cliente semáforos");
  let channelId: string | null = null;
  try {
    channelId = await connectWhatsAppNumber(page, number);
    const text = uniqueMessage(testInfo, "Hola, una pregunta");
    await deliverWebhook(request, webhookBody("text", { number, customer, text }));

    await test.step("[WA-26][WA-27] «Revalidar» asks Meta again and every light is green", async () => {
      if (!channelId) throw new Error("No channel");
      const before = (await metaCalls(mock, "GET", graphPath(number.phoneNumberId))).length;
      await revalidateNumber(page, channelId);
      expect((await metaCalls(mock, "GET", graphPath(number.phoneNumberId))).length, "the number was read again").toBeGreaterThan(before);
      await page.reload();
      for (const label of ["Token", "Registro", "Suscripción", "Avisos", "Calidad", "Nombre", "Envío"]) await expectLight(page, label, "ok");
      await expect(healthLight(page, "Último mensaje")).toBeVisible();
      await expect(healthLight(page, "Límite de mensajes")).toBeVisible();
      await expect(healthLight(page, "Versión de la API")).toBeVisible();
      await expect(page.getByRole("main").getByText(/250 destinatarios cada 24 h/).first(), "[WA-30] the portfolio's limit").toBeVisible();
    });

    await test.step("[SEG-02][PER-07] the owner sees the token masked, never whole", async () => {
      await expect(page.getByRole("main")).toContainText(`••••${META_TOKENS.valid.slice(-4)}`);
      await expect(page.getByText(META_TOKENS.valid)).toHaveCount(0);
      expect(await page.content()).not.toContain(META_TOKENS.valid);
      expect(await page.content()).not.toContain(META.appSecret);
    });

    await test.step("[WA-27] «Pausar IA» and back", async () => {
      await clickAndWaitForPost(page, page.getByRole("main").getByRole("button", { name: "Pausar IA" }));
      await expect(page.getByRole("main").getByRole("button", { name: "Reanudar IA" })).toBeVisible();
      await clickAndWaitForPost(page, page.getByRole("main").getByRole("button", { name: "Reanudar IA" }));
      await expect(page.getByRole("main").getByRole("button", { name: "Pausar IA" })).toBeVisible();
    });

    await test.step("[WA-29][CAN-15] an account notice from Meta starts a check: quality low and the app unsubscribed turn red", async () => {
      if (!channelId) throw new Error("No channel");
      await mock.stub({ service: "meta", method: "GET", path: graphPath(number.phoneNumberId), body: numberAsMetaShowsIt(number, { quality_rating: "RED" }) });
      await mock.stub({ service: "meta", method: "GET", path: graphPath(number.wabaId, "subscribed_apps"), body: { data: [] } });
      // account_update (ACCOUNT_RESTRICTION) of the number's WABA, as Meta sends it (by entry[].id, [WA-33]).
      await deliverWebhook(request, webhookBody("account-update", { number }));
      await expect
        .poll(
          async () => {
            await runQueue(request);
            await page.goto(channelPanelPath(channelId ?? ""));
            return (await healthLight(page, "Calidad").textContent())?.trim() ?? "";
          },
          { message: "the check after Meta's notice ran", timeout: 45_000, intervals: [1_000, 2_000] },
        )
        .toMatch(/Error$/);
      await expectLight(page, "Suscripción", "error");
      await expectChannelState(page, number.name, /Error/);
      // The owner hears about it in the bell.
      const bell = await openNotifications(page);
      await expect(bell).toContainText(number.name);
    });
  } finally {
    await disableChannelQuietly(page, channelId);
  }
});

test("[WA-28][CAN-16][CAN-17] «Desconectar» erases the credentials and, confirmed, removes the WABA subscription and deregisters the number; the history stays and the number's webhooks are no longer stored", async ({
  page,
  request,
  mock,
}, testInfo) => {
  test.setTimeout(240_000);
  const number = testNumber(testInfo, "WhatsApp desconectar");
  // Another number of the same Meta app that stays connected: its App Secret still checks the signature of what Meta
  // sends for the disconnected one, which is verified before the body is read ([WA-32]).
  const sibling = testNumber(testInfo, "WhatsApp misma app");
  const customer = testCustomer(testInfo, "Cliente desconexión");
  let siblingId: string | null = null;
  try {
    siblingId = await connectWhatsAppNumber(page, sibling);
    const channelId = await connectWhatsAppNumber(page, number);
    const before = uniqueMessage(testInfo, "Mensaje antes de desconectar");
    await deliverWebhook(request, webhookBody("text", { number, customer, text: before }));
    await openConversationWith(page, before);

    await disconnectNumber(page, channelId, number.name, { removeFromMeta: true });

    // [WA-28] Out of Meta too: the WABA (no other channel uses it) and the number; the app's own subscription stays.
    await expect.poll(async () => (await metaCalls(mock, "DELETE", graphPath(number.wabaId, "subscribed_apps"))).length).toBe(1);
    expect(await metaCalls(mock, "POST", graphPath(number.phoneNumberId, "deregister"))).toHaveLength(1);
    expect(await metaCalls(mock, "DELETE", graphPath(META.appId, "subscriptions"))).toHaveLength(0);

    // [CAN-16] «Desactivado», with its history.
    await expectChannelState(page, number.name, /Desactivado/);
    await openConversationWith(page, before);

    // [CAN-17] Without its credentials Meta's webhooks for the number are answered (signed by the app) and not stored ([WA-34]).
    const after = uniqueMessage(testInfo, "Mensaje después de desconectar");
    expect((await postWebhook(request, webhookBody("text", { number, customer, text: after }))).status()).toBe(200);
    await expect(await searchInbox(page, after)).toHaveCount(0);
    // And the panel never shows a secret again: there is none.
    await page.goto(channelPanelPath(channelId));
    await expect(page.getByText(/••••/)).toHaveCount(0);
    // [WA-26] Nor the old green lights: a disconnected number is not checked with Meta.
    for (const label of ["Token", "Registro", "Suscripción"]) await expectLight(page, label, "off");
    await expect(page.getByText("Número desconectado: no se revisa con Meta.")).toBeVisible();
  } finally {
    await disableChannelQuietly(page, siblingId);
  }
});
