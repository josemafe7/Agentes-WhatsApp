// Models of an agent ([MOD-01]–[MOD-05], [MOD-07], [MOD-08]) against the simulated OpenRouter catalogue of
// e2e/mocks/routes/openrouter.mjs: four providers offered (OpenAI ×2, Google, Anthropic; Mistral only in the public
// list) and one model for every exclusion rule (no tools, free, zero price, batch, alias, router, retiring, and the
// transcription and embedding models).
import {
  aiSettingsLinksOutsideBanner,
  chatRequests,
  OPENROUTER_TEST_KEYS,
  PUBLIC_MODELS_PATH,
  USER_MODELS_PATH,
} from "../support/ai";
import {
  agentPath,
  chooseModel,
  closeModelPicker,
  createAgentFromTemplate,
  expectSaved,
  modelOption,
  modelPicker,
  modelSearch,
  openModelPicker,
  saveEditor,
  sendTestMessage,
  testChatLog,
  usd,
} from "../support/agents";
import { authStatePath } from "../support/app";
import { expect, test } from "../support/test";
import { clickAndWaitForPost } from "../support/ui";

/** Offered: tools, a price and no retirement date ([MOD-02]). Names as the picker shows them, without the provider. */
const OFFERED = ["GPT-5.6 Luna", "GPT-6 Luna", "Gemini 3.1 Flash Lite", "Claude Haiku 4.5"];
/** Never offered to an agent ([MOD-02]): one of each rule, plus models that do not chat. */
const NEVER_OFFERED = [
  "Llama 3.2 3B Instruct", // no tools
  "Qwen3.8 27B", // :free
  "Space Bunny Alpha", // zero price («stealth»)
  "Gemini 2.5 Flash", // :batch
  "Claude Haiku Latest", // ~alias
  "Auto Router", // router, negative price
  "DeepSeek V3.2", // retiring
  "Whisper Large v3 Turbo", // transcription
  "Voxtral Mini Transcribe", // transcription
  "Text Embedding 3 Small", // embeddings
];
/** In the public list only: the account's privacy settings leave it out of /models/user ([MOD-01]). */
const PUBLIC_ONLY = "Mistral Small 3.2";

test.use({ storageState: authStatePath("owner") });

test("[MOD-08][ARR-14] without a key the model list is not loaded and the Modelo tab says why, with the way to Ajustes › IA", async ({ page, mock }) => {
  const agentId = await createAgentFromTemplate(page);
  await page.goto(agentPath(agentId, "modelo"));
  await expect(modelPicker(page, "primary")).toBeDisabled();
  await expect.poll(() => aiSettingsLinksOutsideBanner(page), { message: "a link to Ajustes › IA next to the picker" }).toBeGreaterThan(0);

  const catalogCalls = (await mock.requests({ service: "openrouter", method: "GET" })).filter((call) => call.path.startsWith(PUBLIC_MODELS_PATH));
  expect(catalogCalls, "nothing asked OpenRouter for models").toHaveLength(0);
});

test.describe("with the OpenRouter key", () => {
  test("[MOD-01][MOD-02][MOD-03][MOD-04] the picker offers only models with tools and shows provider, prices per million in US$, context and what they accept", async ({
    page,
    openRouterKey,
  }) => {
    expect(openRouterKey).toBe(OPENROUTER_TEST_KEYS.valid);
    const agentId = await createAgentFromTemplate(page);
    await page.goto(agentPath(agentId, "modelo"));
    const list = await openModelPicker(page, "primary");

    for (const name of OFFERED) await expect(modelOption(list, name), `${name} is offered`).toBeVisible();
    for (const name of NEVER_OFFERED) await expect(modelOption(list, name), `${name} is not offered`).toHaveCount(0);

    // [MOD-03] Name, provider, input and output price per million tokens in US$, context and image/PDF/audio.
    const luna = modelOption(list, "GPT-5.6 Luna");
    await expect(luna).toContainText("OpenAI");
    await expect(luna).toContainText(usd("0,20"));
    await expect(luna).toContainText(usd("1,20"));
    await expect(luna).toContainText(/1,05\s*M/);
    await expect(luna).toContainText("Imagen");
    await expect(luna).toContainText("PDF");
    await expect(luna).not.toContainText("Audio");
    const haiku = modelOption(list, "Claude Haiku 4.5");
    await expect(haiku).toContainText("Anthropic");
    await expect(haiku).toContainText(usd("1,00"));
    await expect(haiku).toContainText(usd("5,00"));
    await expect(haiku).toContainText(/200\s*k/);
    const gemini = modelOption(list, "Gemini 3.1 Flash Lite");
    await expect(gemini).toContainText("Google");
    await expect(gemini).toContainText(usd("0,25"));
    await expect(gemini).toContainText(usd("1,50"));
    await expect(gemini).toContainText("Audio");

    // [MOD-04] The recommended models of Ajustes › IA come first, and the search narrows the list.
    await expect(list.getByRole("group", { name: "Recomendados" })).toContainText("GPT-5.6 Luna");
    await modelSearch(page).fill("gemini");
    await expect(modelOption(list, "Gemini 3.1 Flash Lite")).toBeVisible();
    await expect(modelOption(list, "GPT-5.6 Luna")).toBeHidden();
    await expect(modelOption(list, "Claude Haiku 4.5")).toBeHidden();
    await closeModelPicker(page);
  });

  test("[MOD-01] «Actualizar lista» asks OpenRouter with the business key and, if the account's list fails, uses the general one", async ({
    page,
    mock,
    openRouterKey,
  }) => {
    const agentId = await createAgentFromTemplate(page);
    await page.goto(agentPath(agentId, "modelo"));
    const list = await openModelPicker(page, "primary");
    const refresh = page.getByRole("button", { name: "Actualizar lista" });

    await test.step("the account's list, asked with the key saved in Ajustes › IA, respects its privacy settings", async () => {
      // The list is already loaded (from the 12 h cache or OpenRouter): from here on, calls come from «Actualizar lista».
      await expect(modelOption(list, "GPT-5.6 Luna")).toBeVisible();
      await mock.reset();
      await clickAndWaitForPost(page, refresh);
      const accountLists = () => mock.requests({ service: "openrouter", method: "GET", path: USER_MODELS_PATH });
      await expect.poll(async () => (await accountLists()).length, { message: "«Actualizar lista» asks OpenRouter" }).toBeGreaterThan(0);
      expect((await accountLists()).at(-1)?.headers.authorization).toBe(`Bearer ${openRouterKey}`);
      await expect(page.getByText("Lista de tu cuenta de OpenRouter")).toBeVisible();
      await expect(modelOption(list, "GPT-5.6 Luna")).toBeVisible();
      await expect(modelOption(list, PUBLIC_ONLY)).toHaveCount(0);
    });

    await test.step("if the account's list fails, the general list is used", async () => {
      await mock.stub({
        service: "openrouter",
        method: "GET",
        path: USER_MODELS_PATH,
        status: 500,
        body: { error: { code: 500, message: "Internal Server Error" } },
        times: 1,
      });
      await clickAndWaitForPost(page, refresh);
      await expect(page.getByText("Lista general de OpenRouter")).toBeVisible();
      await expect(modelOption(list, PUBLIC_ONLY)).toBeVisible();
      expect((await mock.requests({ service: "openrouter", method: "GET", path: PUBLIC_MODELS_PATH })).length).toBeGreaterThan(0);
    });

    await test.step("the next update goes back to the account's list (and leaves it cached for the other tests)", async () => {
      await clickAndWaitForPost(page, refresh);
      await expect(page.getByText("Lista de tu cuenta de OpenRouter")).toBeVisible();
      await expect(modelOption(list, PUBLIC_ONLY)).toHaveCount(0);
    });
    await closeModelPicker(page);
  });

  test("[MOD-05] the fallback model has to be of another provider; a pair of two providers is saved", async ({ page, openRouterKey }) => {
    expect(openRouterKey).toBeTruthy();
    const agentId = await createAgentFromTemplate(page);
    await page.goto(agentPath(agentId, "modelo"));
    await chooseModel(page, "primary", "GPT-5.6 Luna");

    // Another OpenAI model cannot back up an OpenAI model: it is not offered as fallback or it is refused on saving.
    const fallbacks = await openModelPicker(page, "fallback");
    const sameProvider = modelOption(fallbacks, "GPT-6 Luna");
    await expect(sameProvider).toBeVisible();
    if ((await sameProvider.getAttribute("aria-disabled")) === "true") {
      await expect(sameProvider).toContainText(/mismo proveedor/i);
      await closeModelPicker(page);
    } else {
      await sameProvider.click();
      await saveEditor(page);
      await expect(page.getByText(/otro proveedor/i).first()).toBeVisible();
      page.once("dialog", (dialog) => void dialog.accept());
      await page.reload();
      await expect(modelPicker(page, "fallback")).not.toContainText("GPT-6 Luna");
    }

    await chooseModel(page, "primary", "Claude Haiku 4.5");
    await chooseModel(page, "fallback", "Gemini 3.1 Flash Lite");
    await saveEditor(page);
    await expectSaved(page);
    await page.reload();
    await expect(modelPicker(page, "primary")).toContainText("Claude Haiku 4.5");
    await expect(modelPicker(page, "fallback")).toContainText("Gemini 3.1 Flash Lite");
  });

  test("[MOD-07][MOT-08] the temperature and length chosen for the agent reach the model, low reasoning by default, and temperature only if the model takes it", async ({
    page,
    mock,
    openRouterKey,
  }) => {
    expect(openRouterKey).toBeTruthy();
    const agentId = await createAgentFromTemplate(page);

    await test.step("Claude Haiku 4.5 takes a temperature and has no reasoning control", async () => {
      await page.goto(agentPath(agentId, "modelo"));
      await chooseModel(page, "primary", "Claude Haiku 4.5");
      await chooseModel(page, "fallback", "Gemini 3.1 Flash Lite");
      await page.getByLabel(/^Temperatura/).fill("0,4");
      await page.getByLabel(/^Longitud máxima/).fill("500");
      await saveEditor(page);
      await expectSaved(page);

      await page.goto(agentPath(agentId, "probar"));
      await sendTestMessage(page, "Hola");
      await expect(testChatLog(page)).toContainText("Me has escrito: «Hola»");
      const [sent] = await chatRequests(mock);
      expect(sent.body.models?.[0]).toBe("anthropic/claude-haiku-4.5");
      expect(sent.body.temperature).toBe(0.4);
      expect(sent.body.max_tokens).toBe(500);
      expect(sent.body.reasoning).toBeUndefined();
    });

    await test.step("GPT-5.6 Luna does not take a temperature and reasons «low» unless told otherwise", async () => {
      await page.goto(agentPath(agentId, "modelo"));
      await chooseModel(page, "primary", "GPT-5.6 Luna");
      await expect(page.getByText(/no permite ajustar la temperatura/i)).toBeVisible();
      await saveEditor(page);
      await expectSaved(page);

      await mock.reset();
      await page.goto(agentPath(agentId, "probar"));
      await sendTestMessage(page, "Hola otra vez");
      await expect(testChatLog(page)).toContainText("Me has escrito: «Hola otra vez»");
      const [sent] = await chatRequests(mock);
      expect(sent.body.models?.[0]).toBe("openai/gpt-5.6-luna");
      expect(sent.body.temperature).toBeUndefined();
      expect(sent.body.reasoning?.effort).toBe("low");
      expect(sent.body.max_tokens).toBe(500);
    });
  });
});
