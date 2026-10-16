// How the busiest screens use the room they have (DESIGN.md «Layout», docs/pantallas.md «Conversación» and «Agenda»):
// a conversation is never squeezed by what is around it and its reply box is always in sight, without scrolling the
// page; on a phone the Agenda keeps one main action and moves the rest into a menu. It only looks at the demo's data.
import type { Locator, Page } from "@playwright/test";
import { authStatePath } from "../support/app";
import { conversationLog, customerMessage, openConversationWith } from "../support/inbox";
import { expect, test } from "../support/test";

test.use({ storageState: authStatePath("owner") });

/** Last message of the demo's hand-off conversation: the one with most over the messages (the notice and its summary). */
const DEMO_HANDOFF_MESSAGE = "Vale, gracias. Estoy un poco preocupada.";
/** DESIGN.md «Bandeja»: the conversation keeps at least this width next to the list and the contact card. */
const CONVERSATION_MIN_WIDTH = 480;
const WIDE = { width: 1600, height: 900 };
const PHONE = { width: 390, height: 844 };

function composer(page: Page): Locator {
  return page.getByRole("main").getByRole("textbox", { name: /^(Respuesta al cliente|Nota interna)$/ });
}

async function widthOf(locator: Locator): Promise<number> {
  return (await locator.boundingBox())?.width ?? 0;
}

/** The inbox takes the height left under the notices: its columns scroll, the page does not. */
async function expectNoPageScroll(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight), { message: "the page itself does not scroll" }).toBe(true);
}

test("[BAN-04][BAN-10][BAN-15] a conversation fits the screen: the reply box is in sight, and the contact card only goes next to it when both have room", async ({
  page,
}) => {
  await openConversationWith(page, DEMO_HANDOFF_MESSAGE);
  const log = conversationLog(page);
  const card = page.getByRole("complementary", { name: "Ficha del contacto" });

  await test.step("on a laptop with the menu open, the card is a side panel and the conversation keeps its width", async () => {
    await expect(composer(page)).toBeInViewport();
    await expect(customerMessage(page, DEMO_HANDOFF_MESSAGE)).toBeInViewport();
    await expectNoPageScroll(page);
    expect(await widthOf(log)).toBeGreaterThanOrEqual(CONVERSATION_MIN_WIDTH);
    await expect(card).toBeHidden();

    await page.getByRole("button", { name: "Ficha del contacto" }).click();
    const panel = page.getByRole("dialog", { name: "Ficha del contacto" });
    await expect(panel).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
  });

  await test.step("on a wide screen the card is a column, and the conversation still keeps its width", async () => {
    await page.setViewportSize(WIDE);
    await expect(card).toBeVisible();
    expect(await widthOf(log)).toBeGreaterThanOrEqual(CONVERSATION_MIN_WIDTH);
    await expect(composer(page)).toBeInViewport();
    await expectNoPageScroll(page);
  });

  await test.step("on a phone the conversation is the whole screen, with its way back and the reply box in sight", async () => {
    await page.setViewportSize(PHONE);
    // Opened on the phone, as a person would: the messages start at the last one.
    await page.reload();
    await expect(page.getByRole("main").getByRole("link", { name: "Atrás, a la bandeja" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Conversaciones" })).toBeHidden();
    await expect(card).toBeHidden();
    await expect(composer(page)).toBeInViewport();
    await expect(customerMessage(page, DEMO_HANDOFF_MESSAGE)).toBeInViewport();
    await expectNoPageScroll(page);
  });
});

test("[AGD-18] on a phone the Agenda keeps «Nueva cita» and moves «Bloquear hueco» into «Más acciones» (DESIGN.md «Cabecera de página»)", async ({ page }) => {
  await page.goto("/agenda");
  const main = page.getByRole("main");
  const blockButton = main.getByRole("button", { name: "Bloquear hueco" });
  await expect(blockButton).toBeVisible();

  await page.setViewportSize(PHONE);
  await expect(blockButton).toBeHidden();
  await expect(main.getByRole("button", { name: /^Nueva (cita|reserva)$/ })).toBeVisible();
  await main.getByRole("button", { name: "Más acciones" }).click();
  await page.getByRole("menuitem", { name: "Bloquear hueco" }).click();
  const dialog = page.getByRole("dialog", { name: "Bloquear hueco" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialog).toBeHidden();
});
