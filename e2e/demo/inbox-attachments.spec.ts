// A person sends a file from the Bandeja when the channel takes it ([BAN-14], [CAN-14]): a web chat with «Imágenes» on
// offers «Adjuntar una imagen», the photo goes with its text, shows in the conversation and reaches the visitor.
// The chat has no agent, so the AI never answers here ([CAN-03]).
import { authStatePath } from "../support/app";
import { createWebchatChannel, widgetDemoPath } from "../support/channels";
import { conversationLog, openConversationWith, replyBox, sendReplyButton } from "../support/inbox";
import { uniqueMessage, uniqueName } from "../support/names";
import { expect, test } from "../support/test";
import { clickAndWaitForPost } from "../support/ui";
import { openVisitor, sendVisitorMessage } from "../support/widget";

test.use({ storageState: authStatePath("owner") });

/** A 1×1 PNG. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test("[BAN-14][CAN-14][BAN-06] a photo attached in the Bandeja reaches the web chat visitor with its text", async ({ page, browser }, testInfo) => {
  test.setTimeout(120_000);
  const withImages = await createWebchatChannel(page, uniqueName(testInfo, "Chat con fotos"), { images: true });
  const withoutImages = await createWebchatChannel(page, uniqueName(testInfo, "Chat sin fotos"));

  const text = uniqueMessage(testInfo, "¿Me enseñáis cómo queda el color cobre?");
  const caption = uniqueMessage(testInfo, "Así queda el cobre");
  const visitor = await openVisitor(browser, testInfo, await widgetDemoPath(page, withImages));
  try {
    await sendVisitorMessage(visitor, text);
    await openConversationWith(page, text);

    await page.getByRole("main").locator('input[type="file"]').setInputFiles({ name: "cobre.png", mimeType: "image/png", buffer: PNG });
    await expect(page.getByText("cobre.png")).toBeVisible();
    await replyBox(page).fill(caption);
    await clickAndWaitForPost(page, sendReplyButton(page));

    // In the conversation: the photo (served by the authenticated file route) with its text.
    const log = conversationLog(page);
    await expect(log.getByText(caption, { exact: true })).toBeVisible();
    await expect(log.locator('img[src^="/api/files/"]').last()).toBeVisible();
    // The visitor gets it without reloading ([WEB-06]).
    await expect(visitor.messages.getByText(caption, { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(visitor.messages.getByRole("img", { name: "Imagen" })).toHaveCount(1);
  } finally {
    await visitor.context.close();
  }

  await test.step("[CAN-14] a web chat without «Imágenes» offers no «Adjuntar»", async () => {
    const other = uniqueMessage(testInfo, "Hola, una pregunta");
    const second = await openVisitor(browser, testInfo, await widgetDemoPath(page, withoutImages), "sin-fotos");
    try {
      await sendVisitorMessage(second, other);
    } finally {
      await second.context.close();
    }
    await openConversationWith(page, other);
    await expect(page.getByRole("button", { name: /^Adjuntar/ })).toHaveCount(0);
  });
});
