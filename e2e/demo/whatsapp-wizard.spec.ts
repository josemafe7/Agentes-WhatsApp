// Canales › Añadir › WhatsApp against the simulated Meta (e2e/mocks/routes/meta.mjs): the whole wizard as the owner uses
// it, and what it says when Meta refuses something. The e2e app has no public HTTPS address (http://localhost), so the
// app's webhook address goes the manual way ([WA-16]); the WABA subscription is always automatic ([WA-14]). Each test
// uses a number of its own and leaves its channel disabled.
import { createNamedAgent } from "../support/agents";
import { authStatePath } from "../support/app";
import { CHANNELS_PATH, channelCard } from "../support/channels";
import { DEMO_URL } from "../support/env";
import { uniqueName } from "../support/names";
import { expect, test } from "../support/test";
import { clickAndWaitForPost } from "../support/ui";
import {
  activateNumber,
  connectValidatedNumber,
  continueWizard,
  disableChannelQuietly,
  expectChannelState,
  fillNumberData,
  finishAgentStep,
  NEW_WHATSAPP_PATH,
  passNumberNotice,
  sendTestReplyButton,
  understoodCheckbox,
  validateWithMeta,
  validationError,
  validationSummary,
  verificationPending,
  verificationReceived,
  wabaNotSubscribed,
  wabaSubscribed,
  webhookValuesToCopy,
  wizardContinue,
  wizardStepPath,
  writeHolaInstruction,
} from "../support/whatsapp";
import {
  deliverWebhook,
  e164,
  graphPath,
  META,
  META_TOKENS,
  metaCalls,
  sentMessages,
  testCustomer,
  testNumber,
  verificationRequest,
  verifyInMetaDashboard,
  webhookBody,
  WEBHOOK_PATH,
} from "../support/whatsapp-meta";

test.use({ storageState: authStatePath("owner") });

/** What «Enviar respuesta de prueba» says (src/app/(app)/canales/nuevo/whatsapp/actions.ts). */
const TEST_REPLY = /mensaje de prueba/i;

test("[WA-01][WA-02][WA-04][WA-05][WA-06][WA-08][WA-12][WA-13][WA-14][WA-15][WA-16][WA-17][WA-22][WA-23][WA-25][CAN-15] the wizard connects a number with the simulated Meta: validates it, subscribes the WABA, registers it, syncs the templates, shows the test message and sends the test reply", async ({
  page,
  request,
  mock,
}, testInfo) => {
  test.setTimeout(240_000);
  const number = testNumber(testInfo, "WhatsApp asistente");
  const customer = testCustomer(testInfo, "Cliente hola");
  const agentName = uniqueName(testInfo, "Agente WhatsApp");
  await createNamedAgent(page, agentName);
  let channelId: string | null = null;

  try {
    await test.step("[WA-02] Paso 0: without ticking the notice there is no way on", async () => {
      await page.goto(NEW_WHATSAPP_PATH);
      await expect(understoodCheckbox(page)).not.toBeChecked();
      await expect(page.getByRole("main").getByRole("button", { name: "Continuar", exact: true })).toBeDisabled();
      await passNumberNotice(page);
    });

    await test.step("[WA-04][WA-05][WA-06][WA-08] Paso 1: «Validar con Meta» asks Meta and shows «Negocio · Número · Estado»", async () => {
      await fillNumberData(page, { name: number.name, token: META_TOKENS.valid, appSecret: META.appSecret, phoneNumberId: number.phoneNumberId });
      await validateWithMeta(page);
      const summary = validationSummary(page);
      await expect(summary).toContainText(META.verifiedName);
      await expect(summary).toContainText(number.displayPhoneNumber);

      // [WA-05] The number with the system user's token (its WABA, app and portfolio come in health_status).
      const phoneCalls = await metaCalls(mock, "GET", graphPath(number.phoneNumberId));
      expect(phoneCalls.length, "the number was read from Meta").toBeGreaterThan(0);
      expect(phoneCalls[0].headers.authorization).toBe(`Bearer ${META_TOKENS.valid}`);
      expect(phoneCalls[0].query.fields).toContain("health_status");
      // [WA-06] The token checked with the app token (APP_ID|APP_SECRET) and nothing else.
      const debug = await metaCalls(mock, "GET", graphPath("debug_token"));
      expect(debug.at(-1)?.query).toMatchObject({ input_token: META_TOKENS.valid, access_token: `${META.appId}|${META.appSecret}` });

      channelId = await connectValidatedNumber(page);
    });

    await test.step("[WA-12][WA-13][WA-14][WA-15][WA-16] Paso 2: one address for the installation, the WABA subscribed and checked, Meta's verification live", async () => {
      const { callbackUrl, verifyToken } = await webhookValuesToCopy(page);
      // [WA-12] Built from the installation's address, the same for every number.
      expect(callbackUrl).toBe(`${DEMO_URL}${WEBHOOK_PATH}`);
      expect(verifyToken.length, "a verify token generated for the installation").toBeGreaterThanOrEqual(16);
      // [WA-16] Without public HTTPS the wizard says so: the data can be validated, real messages will not arrive.
      await expect(page.getByRole("main").getByText(/no tiene una direcci[oó]n p[uú]blica con HTTPS/).first()).toBeVisible();
      // Meta could not reach http://localhost: the automatic subscription of the app is not even tried.
      expect(await metaCalls(mock, "POST", graphPath(META.appId, "subscriptions"))).toHaveLength(0);

      // [WA-14][WA-15] POST /{WABA}/subscribed_apps without a body (never override_callback_uri), then checked with GET.
      await expect(wabaSubscribed(page)).toBeVisible({ timeout: 20_000 });
      const subscriptions = await metaCalls(mock, "POST", graphPath(number.wabaId, "subscribed_apps"));
      expect(subscriptions).toHaveLength(1);
      expect(subscriptions[0].body).toBeNull();
      expect(await metaCalls(mock, "GET", graphPath(number.wabaId, "subscribed_apps"))).not.toHaveLength(0);

      // [WA-13] The person pastes both into the app dashboard and presses «Verificar y guardar»: it turns green live.
      await expect(verificationPending(page)).toBeVisible();
      const dashboard = await verifyInMetaDashboard(callbackUrl, verifyToken);
      expect(dashboard).toEqual({ success: true, verification: { status: 200, echoed: true } });
      await expect(verificationReceived(page)).toBeVisible({ timeout: 15_000 });
      await continueWizard(page);
    });

    await test.step("[WA-17][WA-21][WA-22] Paso 3: registered with a 6-digit PIN, checklist and templates", async () => {
      await activateNumber(page);
      const registrations = await metaCalls(mock, "POST", graphPath(number.phoneNumberId, "register"));
      expect(registrations).toHaveLength(1);
      expect(registrations[0].body).toMatchObject({ messaging_product: "whatsapp", pin: expect.stringMatching(/^\d{6}$/) });
      expect(await metaCalls(mock, "GET", graphPath(number.wabaId, "message_templates")), "[WA-22] the templates were read from Meta").not.toHaveLength(0);
      await continueWizard(page);
    });

    await test.step("[WA-23] Paso 4: «hola» shows when it arrives and «Enviar respuesta de prueba» answers it", async () => {
      await expect(writeHolaInstruction(page, number)).toBeVisible();
      await deliverWebhook(request, webhookBody("text", { number, customer, text: "hola" }));
      await expect(page.getByRole("main").getByText("hola", { exact: true }).first(), "the message appears without reloading").toBeVisible({ timeout: 30_000 });
      await clickAndWaitForPost(page, sendTestReplyButton(page));
      await expect
        .poll(async () => (await sentMessages(mock, number)).length, { message: "the test reply reached Meta" })
        .toBe(1);
      const [reply] = await sentMessages(mock, number);
      // To «+» + the wa_id Meta gave; never both destinations ([WA-39]).
      expect(reply).toMatchObject({ messaging_product: "whatsapp", to: e164(customer), type: "text", text: { body: expect.stringMatching(TEST_REPLY) } });
      expect(reply.recipient).toBeUndefined();
      await continueWizard(page);
    });

    await test.step("[WA-25] Paso 5: agent, AI and test mode «solo a estos números» (on by default)", async () => {
      await finishAgentStep(page, { agentName, aiEnabled: true, testMode: true, allowlist: [e164(customer)] });
      // [CAN-15] Checked when connected: «Conectado».
      await expectChannelState(page, number.name, /Conectado/);
    });
  } finally {
    await disableChannelQuietly(page, channelId);
  }
});

test("[WA-09][WA-13][WA-14][WA-31] the wizard explains Meta's refusals in Spanish: an invalid token (190) stores nothing, a number without the WABA subscription does not connect, and the manual address turns green only with the right verify token", async ({
  page,
  request,
  mock,
}, testInfo) => {
  test.setTimeout(180_000);
  const number = testNumber(testInfo, "WhatsApp errores");
  let channelId: string | null = null;

  try {
    await test.step("[WA-09] 190: the token is not valid — in Spanish, with what to do, and nothing is stored", async () => {
      await passNumberNotice(page);
      await fillNumberData(page, { name: number.name, token: META_TOKENS.invalid, appSecret: META.appSecret, phoneNumberId: number.phoneNumberId });
      await validateWithMeta(page);
      const error = validationError(page);
      await expect(error).toContainText("El token no es válido o ha caducado");
      await expect(error).toContainText("190");
      // What to do, said for the wizard: the panel's «Cambiar token» does not exist here yet.
      await expect(error).toContainText("Pega aquí un token permanente nuevo");
      await expect(error).not.toContainText("Cambiar token");
      await expect(page.getByRole("main").getByRole("button", { name: "Conectar este número" })).toHaveCount(0);
      // Meta answered 190 to the token it was given; the page never shows the token back ([SEG-02]).
      const calls = await metaCalls(mock, "GET", graphPath(number.phoneNumberId));
      expect(calls.at(-1)?.headers.authorization).toBe(`Bearer ${META_TOKENS.invalid}`);
      expect(calls.at(-1)?.status).toBe(401);
      await expect(page.getByText(META_TOKENS.invalid)).toHaveCount(0);
      await page.goto(CHANNELS_PATH);
      await expect(channelCard(page, number.name)).toHaveCount(0);
    });

    await test.step("[WA-14] without the app in the WABA's subscribed apps the number stays «Conectando»", async () => {
      // Meta accepts the POST but the check shows no app: once, then Meta behaves again.
      await mock.stub({ service: "meta", method: "GET", path: graphPath(number.wabaId, "subscribed_apps"), body: { data: [] }, times: 1 });
      await passNumberNotice(page);
      await fillNumberData(page, { name: number.name, token: META_TOKENS.valid, appSecret: META.appSecret, phoneNumberId: number.phoneNumberId });
      await validateWithMeta(page);
      await expect(validationSummary(page)).toContainText(number.displayPhoneNumber);
      channelId = await connectValidatedNumber(page);
      await expect(wabaNotSubscribed(page)).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("main").getByText(/Sin esto no llegan los mensajes/).first()).toBeVisible();
      await expect(wizardContinue(page)).toBeDisabled();
      await expectChannelState(page, number.name, /Conectando/);
    });

    await test.step("[WA-13][WA-31] the manual address: a wrong verify token is refused and nothing turns green; the right one is echoed and turns it green", async () => {
      if (!channelId) throw new Error("No channel");
      // «Continuar configuración»: back to the webhook step, which subscribes the WABA again (now Meta lists the app).
      await page.goto(wizardStepPath(channelId, "webhook"));
      await expect(wabaSubscribed(page)).toBeVisible({ timeout: 20_000 });
      const { callbackUrl, verifyToken } = await webhookValuesToCopy(page);
      await expect(verificationPending(page)).toBeVisible();

      const wrong = await verifyInMetaDashboard(callbackUrl, `${verifyToken}-otro`);
      expect(wrong).toEqual({ success: false, verification: { status: 403, echoed: false } });
      const refused = await verificationRequest(request, "token-que-no-es", "123456789");
      expect(refused.status()).toBe(403);
      expect(await refused.text()).not.toContain("123456789");
      // The wizard asks every few seconds: still waiting after a round.
      await page.waitForTimeout(6_000);
      await expect(verificationPending(page)).toBeVisible();
      await expect(verificationReceived(page)).toHaveCount(0);

      const accepted = await verificationRequest(request, verifyToken, "987654321");
      expect(accepted.status()).toBe(200);
      expect(await accepted.text()).toBe("987654321");
      await expect(verificationReceived(page)).toBeVisible({ timeout: 15_000 });
      await continueWizard(page);
    });
  } finally {
    await disableChannelQuietly(page, channelId);
  }
});
