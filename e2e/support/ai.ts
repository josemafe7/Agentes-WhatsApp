// OpenRouter in the e2e runs: the key of Ajustes › IA ([AJU-04]) and what the simulated OpenRouter
// (e2e/mocks/routes/openrouter.mjs) received or must answer. The demo server starts without a key, so a test that
// needs AI asks for the `openRouterKey` fixture (e2e/support/test.ts), which saves the key as the owner and removes
// it afterwards: the other specs keep seeing the installation without AI ([ARR-14]).
import { expect, type Page } from "@playwright/test";
import scenarios from "../mocks/openrouter-scenarios.json";
import testKeys from "../mocks/test-keys.json";
import type { MockClient } from "./mock-client";
import { clickAndWaitForPost, OPENROUTER_BANNER } from "./ui";

export const OPENROUTER_TEST_KEYS = testKeys.openrouter;
/** The transferir_a_humano call the simulated model makes when the customer asks for «una persona». */
export const HANDOFF_ARGUMENTS = scenarios.handoffArguments;
export const AI_SETTINGS_PATH = "/ajustes/ia";
/** How a saved key shows up: «••••» and its last four characters ([AJU-16], [PER-07]). */
export const VALID_KEY_MASK = `••••${OPENROUTER_TEST_KEYS.valid.slice(-4)}`;

export const CHAT_COMPLETIONS_PATH = "/api/v1/chat/completions";
export const USER_MODELS_PATH = "/api/v1/models/user";
export const PUBLIC_MODELS_PATH = "/api/v1/models";

/** Messages of docs/integracion-openrouter.md «Errores: qué hace la app y qué se muestra». */
export const OPENROUTER_ERROR_MESSAGES = {
  invalidKey: "La clave de OpenRouter no es válida o ha caducado",
  noCredits: "Tu cuenta de OpenRouter no tiene saldo suficiente",
} as const;

/**
 * The input of the OpenRouter key: «Clave» in Ajustes › IA («Clave guardada» after «Cambiar» when one is saved) or
 * «Clave de OpenRouter» in the setup wizard. Only the input: a saved key is just «••••1234» and «Cambiar».
 */
export function openRouterKeyField(page: Page) {
  return page.getByRole("textbox", { name: /^Clave( de OpenRouter| guardada)?$/ });
}

/**
 * The global «Añade tu clave de OpenRouter» notice ([ARR-14], a note at the top of the content). Model pickers and
 * «Probar» repeat the sentence in their own place; this is only the global one.
 */
export function openRouterBanner(page: Page) {
  return page.locator('[role="note"]').filter({ hasText: OPENROUTER_BANNER });
}

/** Links to Ajustes › IA outside the global notice: the screen itself explains that the key is missing ([MOD-08], [PRU-07]). */
export async function aiSettingsLinksOutsideBanner(page: Page): Promise<number> {
  return page
    .locator(`main a[href^="${AI_SETTINGS_PATH}"]`)
    .evaluateAll((links) => links.filter((link) => !link.closest('[role="note"]')).length);
}

/** Saves `key` in Ajustes › IA as the person signed in on `page` (owner or administrator). */
export async function saveOpenRouterKey(page: Page, key: string = OPENROUTER_TEST_KEYS.valid): Promise<void> {
  await page.goto(AI_SETTINGS_PATH);
  const field = openRouterKeyField(page);
  // With a key already saved there is only «••••1234» and «Cambiar»: the first «Cambiar» is the OpenRouter one.
  const change = page.getByRole("button", { name: "Cambiar", exact: true }).first();
  await expect(field.or(change).first()).toBeVisible();
  if (!(await field.isVisible())) await change.click();
  await field.fill(key);
  await clickAndWaitForPost(page, page.getByRole("button", { name: /^Guardar( cambios| clave)?$/ }).first());
  await expect(page.getByText(`••••${key.slice(-4)}`).first(), "the saved key shows masked").toBeVisible();
  // The whole panel now knows there is AI.
  await page.reload();
  await expect(openRouterBanner(page)).toHaveCount(0);
}

/** «Quitar clave» in Ajustes › IA, if a key is saved there. Leaves the installation without AI again. */
export async function removeOpenRouterKey(page: Page): Promise<void> {
  await page.goto(AI_SETTINGS_PATH);
  const remove = page.getByRole("button", { name: "Quitar clave", exact: true }).first();
  if ((await remove.count()) === 0) return;
  await remove.click();
  const dialog = page.getByRole("alertdialog");
  await clickAndWaitForPost(page, dialog.getByRole("button", { name: "Quitar clave", exact: true }));
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await expect(openRouterBanner(page)).toBeVisible();
}

// ─── What the simulated OpenRouter received ─────────────────────────────────────────────────────────────

export type ChatMessageSent = { role: string; content: unknown; tool_call_id?: string };
export type ChatRequestSent = {
  headers: Record<string, string>;
  body: {
    model?: string;
    models?: string[];
    messages: ChatMessageSent[];
    tools?: { type?: string; function?: { name?: string } }[];
    provider?: Record<string, unknown>;
    stream?: boolean;
    session_id?: string;
    max_tokens?: number;
    reasoning?: { effort?: string };
    temperature?: number;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The POST /chat/completions the app sent since the mock was last reset (oldest first). */
export async function chatRequests(mock: MockClient): Promise<ChatRequestSent[]> {
  const requests = await mock.requests({ service: "openrouter", method: "POST", path: CHAT_COMPLETIONS_PATH });
  return requests.map((request) => {
    const body = request.body;
    if (!isRecord(body) || !Array.isArray(body.messages)) throw new Error(`Unexpected chat body: ${JSON.stringify(body)}`);
    return { headers: request.headers, body: body as ChatRequestSent["body"] };
  });
}

/** Text of a message (a string or a list of text parts). */
export function messageText(message: ChatMessageSent | undefined): string {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content.map((part: unknown) => (isRecord(part) && typeof part.text === "string" ? part.text : "")).join("");
  }
  return "";
}

/** Provider prefix of a model id («openai» in openai/gpt-5.6-luna). */
export function providerOfModel(modelId: string): string {
  return modelId.split("/")[0].replace(/^~/, "").toLowerCase();
}

/** OpenRouter's error bodies (docs/integracion-openrouter.md «Forma de los errores»). */
const ERROR_BODIES = {
  401: { error: { code: 401, message: "User not found." } },
  402: { error: { code: 402, message: "Insufficient credits. Add more using https://openrouter.ai/credits", metadata: { limit_source: "openrouter_credits" } } },
  429: { error: { code: 429, message: "Rate limit exceeded", metadata: { error_type: "rate_limit_exceeded" } } },
} as const;

/** The next `times` chat requests fail with `status`, as OpenRouter answers it. */
export async function stubChatError(mock: MockClient, status: keyof typeof ERROR_BODIES, times = 1): Promise<void> {
  await mock.stub({
    service: "openrouter",
    method: "POST",
    path: CHAT_COMPLETIONS_PATH,
    status,
    headers: status === 429 ? { "retry-after": "1" } : {},
    body: ERROR_BODIES[status],
    times,
  });
}
