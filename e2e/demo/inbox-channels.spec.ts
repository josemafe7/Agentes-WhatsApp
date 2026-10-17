// The channel of each conversation in the Bandeja ([BAN-17]) with the demo's own channels (seed/steps/channels.ts):
// every row of the list says its channel's type and name in a pill, and the «Canal» filter and its chip name each
// channel the same way. The texts are what channelMarkText() (src/app/(app)/bandeja/_lib/channel-mark.ts) gives for the
// hair-salon demo «Peluquería Aurora»: a name that only repeats its type is said once («WhatsApp» called «WhatsApp»;
// «Correo» is the start of «Correo · Gmail»). Instagram is also proved with an account of its own in
// instagram.spec.ts. Other tests add channels and conversations of their own: this one looks for the demo's customers
// (seed/steps/conversations.ts) and never counts.
import type { Page } from "@playwright/test";
import { authStatePath } from "../support/app";
import { conversationLinks, openInbox, searchInbox } from "../support/inbox";
import { expect, test } from "../support/test";

test.use({ storageState: authStatePath("owner") });

/** A customer of the demo and how the Bandeja names the channel they wrote by. */
const DEMO_CONVERSATIONS = [
  { contact: "Laura Gil", channel: "WhatsApp" },
  { contact: "Sergio Vidal", channel: "Chat web · Chat de la web" },
  { contact: "Isabel Prieto", channel: "Correo · Gmail" },
  { contact: "Celia Navas", channel: "Instagram · @peluqueria_aurora.demo" },
] as const;

const main = (page: Page) => page.getByRole("main");

test("[BAN-17] each demo conversation says its channel in the list, with its type and its name", async ({ page }) => {
  for (const { contact, channel } of DEMO_CONVERSATIONS) {
    await test.step(`${contact}: «${channel}»`, async () => {
      const row = (await searchInbox(page, contact)).filter({ hasText: contact }).first();
      await expect(row).toBeVisible();
      await expect(row.getByText(channel, { exact: true }).first()).toBeVisible();
    });
  }
});

test("[BAN-17] the «Canal» filter offers each demo channel with its type, and its chip and the rows name it the same", async ({ page }) => {
  await openInbox(page);
  await main(page).getByRole("button", { name: /^Filtros/ }).click();
  const options = page.getByRole("option");

  await test.step("every demo channel is offered by its type and its name", async () => {
    await page.getByRole("combobox", { name: "Canal", exact: true }).click();
    await expect(options.first()).toBeVisible();
    const offered = (await options.allInnerTexts()).map((label) => label.trim());
    expect(offered).toEqual(expect.arrayContaining(DEMO_CONVERSATIONS.map((conversation) => conversation.channel)));
  });

  await test.step("chosen, its chip and every row of the list say it the same way", async () => {
    const webchat = "Chat web · Chat de la web";
    await page.getByRole("option", { name: webchat, exact: true }).first().click();
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(page).toHaveURL(/[?&]canal=[0-9a-f-]{36}/);
    await expect(main(page).getByRole("list", { name: "Filtros activos" })).toContainText(`Canal: ${webchat}`);
    const rows = conversationLinks(page);
    await expect(rows.first()).toContainText(webchat);
    await expect(rows.filter({ hasNotText: webchat })).toHaveCount(0);
  });
});
