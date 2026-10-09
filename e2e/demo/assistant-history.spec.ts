// [INT-10] on the screen: someone with more conversations than fit in the list, and one longer than what is shown at
// once (e2e/support/assistant-fixtures.ts, left in the database by create-assistant-fixtures.ts), reaches all of them
// with «Cargar más» and «Cargar mensajes anteriores», and can delete the oldest one. The numbers of what is shown at a
// time are the ones of docs/pantallas.md: 50 conversations and 200 messages.
import { authStatePath } from "../support/app";
import { ASSISTANT_HISTORY } from "../support/assistant-fixtures";
import { assistantCard, assistantLog, ASSISTANTS_PATH, DEMO_INTERNAL_AGENT, myConversations } from "../support/assistants";
import { expect, test } from "../support/test";
import { escapeRegExp } from "../support/ui";

const LISTED_AT_A_TIME = 50;
const SHOWN_AT_A_TIME = 200;

test.use({ storageState: authStatePath(ASSISTANT_HISTORY.person) });

test("[INT-10] «Cargar más» brings the older conversations and «Cargar mensajes anteriores» the earlier messages: all can be seen, and deleted", async ({ page }) => {
  const exactly = (text: string) => new RegExp(`^${escapeRegExp(text)}$`);
  const oldest = ASSISTANT_HISTORY.title(1);
  const more = page.getByRole("button", { name: "Cargar más", exact: true });
  const earlier = page.getByRole("button", { name: "Cargar mensajes anteriores", exact: true });

  await page.goto(ASSISTANTS_PATH);
  await assistantCard(page, DEMO_INTERNAL_AGENT).getByRole("link", { name: DEMO_INTERNAL_AGENT, exact: true }).click();

  await test.step("the list starts with the newest ones, and «Cargar más» brings the rest", async () => {
    await expect(myConversations(page)).toHaveCount(LISTED_AT_A_TIME);
    await expect(myConversations(page).first().getByRole("link")).toHaveText(ASSISTANT_HISTORY.longConversation);
    await expect(myConversations(page).getByRole("link", { name: exactly(oldest) })).toHaveCount(0);
    await more.click();
    await expect(myConversations(page)).toHaveCount(ASSISTANT_HISTORY.conversations);
    await expect(myConversations(page).last().getByRole("link")).toHaveText(oldest);
    await expect(more).toHaveCount(0);
  });

  await test.step("the oldest one, which did not fit at first, can be deleted", async () => {
    await page.getByRole("button", { name: `Borrar la conversación «${oldest}»`, exact: true }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText("¿Borrar esta conversación?");
    await confirm.getByRole("button", { name: "Borrar", exact: true }).click();
    await expect(myConversations(page)).toHaveCount(ASSISTANT_HISTORY.conversations - 1);
    await expect(myConversations(page).getByRole("link", { name: exactly(oldest) })).toHaveCount(0);
  });

  await test.step("the long conversation opens with its last messages, and «Cargar mensajes anteriores» brings the first ones", async () => {
    await myConversations(page).first().getByRole("link").click();
    await expect(page).toHaveURL(/\?c=[0-9a-f-]{36}$/);
    const log = assistantLog(page);
    const firstShown = ASSISTANT_HISTORY.messages - SHOWN_AT_A_TIME + 1;
    await expect(log.getByText(ASSISTANT_HISTORY.message(ASSISTANT_HISTORY.messages), { exact: true })).toBeVisible();
    await expect(log.getByText(ASSISTANT_HISTORY.message(firstShown), { exact: true })).toHaveCount(1);
    await expect(log.getByText(ASSISTANT_HISTORY.message(firstShown - 1), { exact: true })).toHaveCount(0);
    await earlier.click();
    await expect(log.getByText(ASSISTANT_HISTORY.message(1), { exact: true })).toHaveCount(1);
    await expect(earlier).toHaveCount(0);
    // What was being read stays in view: the conversation does not jump to its end.
    await expect(log.getByText(ASSISTANT_HISTORY.message(firstShown), { exact: true })).toBeInViewport();
  });
});
