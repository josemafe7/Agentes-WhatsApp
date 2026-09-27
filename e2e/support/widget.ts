// The web chat as a visitor uses it on /widget-demo ([WEB-*]), each visitor in a browser of their own (no session,
// their own IP and storage: a new anonymous visitor, [WEB-04]). Locators follow DESIGN.md «Chat web (widget)» and
// docs/pantallas.md «Prueba del chat web»:
//   /widget-demo   an example page of the business with the notice «Página de prueba del chat web» and the widget.
//   launcher       button «Abrir el chat de {negocio}».
//   panel          a dialog with the conversation; if the legal texts must be accepted first, a button «Aceptar…»;
//                  the composer is a textbox («Escribe tu mensaje…») with «Enviar»; each message shows its text (the
//                  first AI message carries the AI notice in front of it, [CUM-01]). The messages are the list
//                  «Mensajes»; new replies are also read out by a screen-reader-only live region with «{autor}: {texto}»,
//                  so replies are counted in the list, never in the whole panel.
// The widget may live in the page (an open shadow root is fine: Playwright looks inside it) or in an iframe of its
// own; widgetScope finds either.
import { expect, type Browser, type BrowserContext, type FrameLocator, type Locator, type Page, type TestInfo } from "@playwright/test";
import { newPersonContext } from "./app";
import { clientIpFor } from "./test";
import { escapeRegExp } from "./ui";

export const WIDGET_DEMO_NOTICE = "Página de prueba del chat web";
const LAUNCHER = /^Abrir el chat/i;
const WIDGET_FRAME = 'iframe[src*="widget"], iframe[title*="chat" i]';
const MESSAGE_BOX = /mensaje|escribe/i;
const ACCEPT_LEGAL = /^(Aceptar|Acepto|Empezar)/;
/** POST /api/widget/<channel>/messages: the visitor's message (the session has its own address). */
const WIDGET_MESSAGES_API = /^\/api\/widget\/[^/]+\/messages$/;

type WidgetScope = Page | FrameLocator;

export type Visitor = {
  context: BrowserContext;
  page: Page;
  /** The open chat panel. */
  panel: Locator;
  /** The conversation shown in the panel (the list «Mensajes»), without the screen-reader announcements. */
  messages: Locator;
  messageBox: Locator;
  sendButton: Locator;
};

/** The page itself or the widget's iframe, once the widget has loaded. */
async function widgetScope(page: Page): Promise<WidgetScope> {
  const launcher = page.getByRole("button", { name: LAUNCHER });
  const frame = page.locator(WIDGET_FRAME);
  await expect(launcher.or(frame).first(), "the web chat loads on the page").toBeVisible({ timeout: 20_000 });
  return (await launcher.count()) > 0 ? page : page.frameLocator(WIDGET_FRAME).first();
}

/**
 * A new visitor opens `path` (a /widget-demo address) and the chat panel. `label` tells visitors of one test apart
 * (each has its own IP, so the per-IP limits of [WEB-08] never mix them).
 */
export async function openVisitor(browser: Browser, testInfo: TestInfo, path: string, label = "visitante"): Promise<Visitor> {
  const context = await newPersonContext(browser, testInfo, { clientIp: clientIpFor(`${testInfo.testId}:${testInfo.retry}:${label}`) });
  const page = await context.newPage();
  await page.goto(path);
  const scope = await widgetScope(page);
  const panel = scope.getByRole("dialog");
  if (!(await panel.isVisible())) await scope.getByRole("button", { name: LAUNCHER }).click();
  await expect(panel, "the chat panel opens").toBeVisible();

  const messageBox = panel.getByRole("textbox", { name: MESSAGE_BOX });
  const accept = panel.getByRole("button", { name: ACCEPT_LEGAL }).first();
  await expect(messageBox.or(accept).first()).toBeVisible();
  if (await accept.isVisible()) await accept.click();
  await expect(messageBox).toBeEditable();
  return { context, page, panel, messages: panel.getByRole("list", { name: "Mensajes" }), messageBox, sendButton: panel.getByRole("button", { name: /^Enviar/ }) };
}

/** Writes and sends one message; it is stored (the widget API answers) and shows in the panel. */
export async function sendVisitorMessage(visitor: Visitor, text: string): Promise<void> {
  await visitor.messageBox.fill(text);
  const [response] = await Promise.all([
    visitor.page.waitForResponse((candidate) => candidate.request().method() === "POST" && WIDGET_MESSAGES_API.test(new URL(candidate.url()).pathname)),
    visitor.sendButton.click(),
  ]);
  expect(response.status(), `the widget API stores «${text}»`).toBeLessThan(300);
  await expect(visitor.messages.getByText(text, { exact: true })).toBeVisible();
}

/** What the simulated OpenRouter answers for an agent: «Soy <agente>, el asistente de IA de este negocio…». */
export function aiReplyPattern(agentName: string): RegExp {
  return new RegExp(`Soy ${escapeRegExp(agentName)}(?![\\p{L}\\p{N}])`, "u");
}

/** The replies of `agentName` the visitor sees. */
export function visitorAiReplies(visitor: Visitor, agentName: string): Locator {
  return visitor.messages.getByText(aiReplyPattern(agentName));
}

/** Any reply of the simulated model the visitor sees (whichever agent wrote it). */
export function visitorAnyAiReply(visitor: Visitor): Locator {
  return visitor.messages.getByText(/Soy .+, el asistente de IA de este negocio/);
}
