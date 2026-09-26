// Ajustes › IA: the OpenRouter key ([AJU-04], [ASI-07]) — «Probar clave» against the simulated OpenRouter, a saved key
// shown only masked ([AJU-16], [SEG-02], [PER-07]) and the AI turned on and off with it ([ARR-14]).
// The demo server starts without a key; each test leaves it that way (afterEach), so other specs are not affected.
import {
  AI_SETTINGS_PATH,
  OPENROUTER_TEST_KEYS,
  openRouterBanner,
  openRouterKeyField,
  removeOpenRouterKey,
  saveOpenRouterKey,
  VALID_KEY_MASK,
} from "../support/ai";
import { authStatePath, newPersonContext } from "../support/app";
import { clientIpFor, expect, test } from "../support/test";
import { clickAndWaitForPost } from "../support/ui";
import { SECTIONS } from "../support/users";

test.use({ storageState: authStatePath("owner") });

test.afterEach(async ({ browser }, testInfo) => {
  const owner = await newPersonContext(browser, testInfo, {
    clientIp: clientIpFor(`${testInfo.testId}:${testInfo.retry}:cleanup`),
    storageState: authStatePath("owner"),
  });
  try {
    await removeOpenRouterKey(await owner.newPage());
  } finally {
    await owner.close();
  }
});

test("[AJU-04][ASI-07] «Probar clave» asks the simulated OpenRouter and tells a valid key from one that is not", async ({ page, mock }) => {
  await page.goto(AI_SETTINGS_PATH);
  const keyField = openRouterKeyField(page);
  const testButton = page.getByRole("button", { name: "Probar clave" });

  await keyField.fill(OPENROUTER_TEST_KEYS.invalid);
  await clickAndWaitForPost(page, testButton);
  await expect(page.getByText(/no es válida o ha caducado/i).first()).toBeVisible();

  await keyField.fill(OPENROUTER_TEST_KEYS.valid);
  await clickAndWaitForPost(page, testButton);
  await expect(page.getByText("Clave válida", { exact: true })).toBeVisible();
  // What OpenRouter says of the key (GET /key of the simulator): its spending limit and what it has spent, in US$.
  await expect(page.getByText(/74,50\s*US\$/).first()).toBeVisible();
  await expect(page.getByText(/25,50\s*US\$/).first()).toBeVisible();

  const keysSent = (await mock.requests({ service: "openrouter", method: "GET", path: "/api/v1/key" })).map((call) => call.headers.authorization);
  expect(keysSent).toContain(`Bearer ${OPENROUTER_TEST_KEYS.invalid}`);
  expect(keysSent).toContain(`Bearer ${OPENROUTER_TEST_KEYS.valid}`);

  // Testing a key does not save it: the AI is still off.
  await page.goto(SECTIONS.bandeja.href);
  await expect(openRouterBanner(page)).toBeVisible();
});

test("[AJU-04][AJU-16][SEG-02][PER-07][ARR-14] a saved key turns the AI on, is only ever shown as ••••0000 and «Quitar clave» turns it off", async ({
  page,
}) => {
  const key = OPENROUTER_TEST_KEYS.valid;
  await saveOpenRouterKey(page, key);

  await test.step("[SEG-02][PER-07] the browser never gets the whole key, not even in the page data", async () => {
    await page.goto(AI_SETTINGS_PATH);
    await expect(page.getByText(VALID_KEY_MASK).first()).toBeVisible();
    expect(await page.content()).not.toContain(key);
    const html = await page.request.get(AI_SETTINGS_PATH);
    expect(await html.text()).not.toContain(key);
  });

  await test.step("[ARR-14] with a key the notice is gone from the whole panel", async () => {
    await page.goto(SECTIONS.bandeja.href);
    await expect(openRouterBanner(page)).toHaveCount(0);
  });

  await test.step("[AJU-16] «Cambiar» and saving with the field empty keeps the saved key", async () => {
    await page.goto(AI_SETTINGS_PATH);
    await page.getByRole("button", { name: "Cambiar", exact: true }).first().click();
    await expect(openRouterKeyField(page)).toHaveValue("");
    await clickAndWaitForPost(page, page.getByRole("button", { name: /^Guardar( cambios| clave)?$/ }).first());
    await page.reload();
    await expect(page.getByText(VALID_KEY_MASK).first()).toBeVisible();
    await expect(openRouterBanner(page)).toHaveCount(0);
  });

  await test.step("[ARR-14] «Quitar clave» leaves the installation without AI again", async () => {
    await removeOpenRouterKey(page);
    await page.goto(SECTIONS.bandeja.href);
    await expect(openRouterBanner(page)).toBeVisible();
    await page.goto(AI_SETTINGS_PATH);
    await expect(page.getByText(VALID_KEY_MASK)).toHaveCount(0);
  });
});

test("[AJU-04][CUM-10] a transcription model with providers outside OpenRouter's zero-retention list is warned about next to its field", async ({
  page,
  mock,
  openRouterKey,
}) => {
  expect(openRouterKey).toBeTruthy();
  await page.goto(AI_SETTINGS_PATH);
  const transcription = page.getByRole("combobox", { name: /Transcripción de audios/ });

  // The default model: every provider keeps no data.
  await expect(page.getByText("Todos sus proveedores están en la lista sin retención de datos de OpenRouter.")).toBeVisible();

  await transcription.click();
  await page.getByRole("listbox").getByRole("option", { name: /Voxtral Mini Transcribe/ }).click();
  await expect(page.getByText(/no están en la lista sin retención de datos de OpenRouter \(Mistral\)/)).toBeVisible();
  const zdrLists = await mock.requests({ service: "openrouter", method: "GET", path: "/api/v1/endpoints/zdr" });
  expect(zdrLists.length, "the zero-retention list was asked to the simulated OpenRouter").toBeGreaterThan(0);
  const voxtral = await mock.requests({ service: "openrouter", method: "GET", path: "/api/v1/models/mistralai/voxtral-mini-transcribe/endpoints" });
  expect(voxtral.at(-1)?.headers.authorization).toBe(`Bearer ${openRouterKey}`);

  // Nothing is saved until «Guardar»: back to the default one, the warning goes.
  await transcription.click();
  await page.getByRole("listbox").getByRole("option", { name: /Whisper Large v3 Turbo/ }).click();
  await expect(page.getByText("Todos sus proveedores están en la lista sin retención de datos de OpenRouter.")).toBeVisible();
  await expect(page.getByText(/no están en la lista sin retención de datos/)).toHaveCount(0);
});
