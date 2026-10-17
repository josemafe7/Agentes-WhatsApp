// Instagram from end to end ([IG-01], [IG-02], [IG-03], [IG-05], [IG-06], [IG-10], [IG-13], [BAN-17]) against the
// simulated Instagram (e2e/mocks/routes/instagram.mjs): the wizard connects an account with its token and its secret
// (a token Instagram refuses stores nothing), Meta checks the webhook address with the verify token, a customer's DM
// shows in the wizard, the active agent answers with ONE message through Instagram, the Bandeja says the conversation's
// channel and a person answers from it, what the business writes from the Instagram app joins the conversation «Desde
// Instagram» (the app's own sends, echoed back, are not stored twice), a webhook without its signature is refused,
// «Desconectar» deletes the token, and the demo has its Instagram account with a conversation (its channel's pill with
// the demo's other channels: inbox-channels.spec.ts). The tests that connect an account use one of their own and leave
// it disconnected. The rest of [IG-01]–[IG-13] (the 24 h window, deleted messages, the profile, the token's renewal,
// the same account twice, the errors, the AI paused by an echo, the simulator writing by the demo account) is proved
// in Vitest: src/server/channels/instagram/*.test.ts, src/lib/instagram/client.test.ts, the tests of src/data/
// (instagram, simulator, conversations, messages), those next to the Instagram screens and the demo's
// (scripts/lib/seed-conversations.test.ts).
import type { Page } from "@playwright/test";
import { createNamedAgent, uniqueAgentName } from "../support/agents";
import { authStatePath } from "../support/app";
import { untilWithQueue } from "../support/engine";
import { chooseOption } from "../support/forms";
import { conversationLog, customerMessage, openConversationWith, replyAsPerson } from "../support/inbox";
import {
  businessRepliesOnInstagram,
  customerWritesOnInstagram,
  postInstagramWebhook,
  revokedInstagramToken,
  sentByInstagramAccount,
  testInstagramAccount,
  testInstagramCustomer,
  verifyInstagramWebhook,
  type TestInstagramAccount,
} from "../support/instagram";
import { uniqueMessage, uniqueName } from "../support/names";
import { expect, test } from "../support/test";
import { clickAndWaitForPost, escapeRegExp } from "../support/ui";

test.use({ storageState: authStatePath("owner") });

const NEW_INSTAGRAM_PATH = "/canales/nuevo/instagram";
const main = (page: Page) => page.getByRole("main");

async function connectAccount(page: Page, account: TestInstagramAccount, options: { token?: string; agentName?: string } = {}): Promise<void> {
  await page.goto(NEW_INSTAGRAM_PATH);
  await main(page).getByRole("button", { name: "Continuar" }).click();
  await main(page).getByLabel("Token de la cuenta").fill(options.token ?? account.token);
  await main(page).getByLabel("Clave secreta de Instagram").fill(account.appSecret);
  await main(page).getByLabel("Nombre del canal").fill(account.channelName);
  if (options.agentName) await chooseOption(page, main(page).getByRole("combobox", { name: "Agente activo" }), options.agentName);
  await clickAndWaitForPost(page, main(page).getByRole("button", { name: "Conectar cuenta" }));
}

async function disconnectAccount(page: Page, channelId: string, channelName: string): Promise<void> {
  await page.goto(`/canales/${channelId}`);
  await main(page).getByRole("button", { name: "Desconectar", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("textbox", { name: /^Escribe .* para confirmar/ }).fill(channelName);
  await clickAndWaitForPost(page, dialog.getByRole("button", { name: "Desconectar", exact: true }));
  await expect(dialog).toHaveCount(0);
}

test("[IG-01][IG-02][IG-03][IG-05][IG-06][IG-10][BAN-17] the wizard connects an account, the customer's DM arrives, the agent answers once, a person answers from the Bandeja and what the business writes in Instagram joins the conversation", async ({
  page,
  request,
  mock,
  openRouterKey,
}, testInfo) => {
  test.setTimeout(240_000);
  expect(openRouterKey).toBeTruthy();
  const agentName = uniqueAgentName(testInfo, "Agente Instagram");
  await createNamedAgent(page, agentName);
  const account = testInstagramAccount(testInfo, uniqueName(testInfo, "Instagram e2e"));
  const customer = testInstagramCustomer(testInfo, "Lucía");
  let channelId: string | null = null;
  try {
    await test.step("[IG-01] token and secret: the account is checked, shown and subscribed; nothing secret stays on screen", async () => {
      await connectAccount(page, account, { agentName });
      await expect(main(page).getByText(`@${account.username}`).first()).toBeVisible({ timeout: 20_000 });
      expect(await page.content()).not.toContain(account.token);
      expect(await page.content()).not.toContain(account.appSecret);
    });

    await test.step("[IG-01][IG-02] Meta checks the address with its verify token, and the wizard turns green", async () => {
      const callbackUrl = await main(page).getByLabel("URL de devolución de llamada (Callback URL)").inputValue();
      const verifyToken = await main(page).getByLabel("Token de verificación (Verify token)").inputValue();
      channelId = /\/api\/webhooks\/instagram\/([0-9a-f-]{36})$/.exec(callbackUrl)?.[1] ?? null;
      expect(channelId).not.toBeNull();
      expect(await verifyInstagramWebhook(request, account, { callbackUrl, verifyToken })).toBe(true);
      await expect(main(page).getByText("Meta ha comprobado la dirección")).toBeVisible({ timeout: 15_000 });
      // A wrong verify token gets nothing.
      const refused = await request.get(`${callbackUrl}?hub.mode=subscribe&hub.verify_token=otro-token-cualquiera&hub.challenge=123`, { failOnStatusCode: false });
      expect(refused.status()).toBe(403);
    });

    const text = uniqueMessage(testInfo, "Hola, ¿tenéis cita el viernes?");
    await test.step("[IG-03][IG-05] the customer's DM shows in the wizard and the agent answers with one message", async () => {
      await main(page).getByRole("button", { name: "Continuar" }).click();
      await customerWritesOnInstagram(request, account, customer, text);
      await untilWithQueue(request, async () => (await main(page).getByText("Ha llegado tu mensaje").count()) > 0, "the customer's DM shows in the wizard");
      const reply = new RegExp(`Te escribo por mensajes directos de Instagram\\. Me has escrito: «${escapeRegExp(text)}»`);
      await untilWithQueue(request, async () => (await sentByInstagramAccount(mock, account)).some((message) => reply.test(message.text)), "the agent's reply went out through Instagram");
      const sent = await sentByInstagramAccount(mock, account);
      expect(sent).toHaveLength(1);
      expect(sent[0].recipient).toBe(customer.id);
    });

    await test.step("[BAN-17] the Bandeja says which channel the conversation is from; a person answers from it", async () => {
      await openConversationWith(page, text);
      await expect(customerMessage(page, text)).toBeVisible();
      await expect(main(page).getByText(`Instagram · ${account.channelName}`).first()).toBeVisible();
      const answer = uniqueMessage(testInfo, "Sí, a las 17:00");
      await replyAsPerson(page, answer);
      await untilWithQueue(request, async () => (await sentByInstagramAccount(mock, account)).some((message) => message.text === answer), "the person's answer went out through Instagram");
    });

    await test.step("[IG-06] what the business writes from the Instagram app joins the conversation «Desde Instagram»", async () => {
      const fromApp = uniqueMessage(testInfo, "Te llamo luego para confirmar");
      await businessRepliesOnInstagram(request, account, customer, fromApp);
      await untilWithQueue(
        request,
        async () => {
          await page.reload();
          return (await conversationLog(page).getByText(fromApp).count()) > 0;
        },
        "the echo joins the conversation",
        60_000,
      );
      await expect(conversationLog(page).getByText("Desde Instagram").first()).toBeVisible();
      // The app's own sends came back as echoes too, and were not stored twice.
      const answers = await sentByInstagramAccount(mock, account);
      for (const message of answers) await expect(conversationLog(page).getByText(message.text)).toHaveCount(1);
    });

    await test.step("[IG-02] a webhook without the account's signature is refused", async () => {
      const body = JSON.stringify({ object: "instagram", entry: [] });
      const url = `${new URL(page.url()).origin}/api/webhooks/instagram/${channelId}`;
      expect((await postInstagramWebhook(request, url, body, { appSecret: "no-es-la-clave" })).status()).toBe(401);
      expect((await postInstagramWebhook(request, url, body, null)).status()).toBe(401);
    });

    await test.step("[IG-10] «Desconectar» deletes the token and keeps the history", async () => {
      await disconnectAccount(page, channelId ?? "", account.channelName);
      channelId = null;
    });
  } finally {
    if (channelId) await disconnectAccount(page, channelId, account.channelName).catch(() => undefined);
  }
});

test("[IG-01] a token Instagram refuses stores nothing and says why in Spanish", async ({ page }, testInfo) => {
  const account = testInstagramAccount(testInfo, uniqueName(testInfo, "Instagram rechazado"));
  await connectAccount(page, account, { token: revokedInstagramToken(account) });
  await expect(main(page).getByText("El token de Instagram no es válido o ha caducado.")).toBeVisible();
  await page.goto("/canales");
  await expect(main(page).getByText(account.channelName)).toHaveCount(0);
});

test("[IG-13][BAN-17] the demo has an Instagram account with a conversation, and the Bandeja says it is Instagram", async ({ page }) => {
  await page.goto("/bandeja");
  const row = main(page).getByRole("link").filter({ hasText: "Instagram" }).first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(main(page).getByText(/^Instagram/).first()).toBeVisible();
});
