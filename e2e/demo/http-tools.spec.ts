// Custom HTTP tools ([HER-11]–[HER-14], [AGE-08]): the owner creates a tool that calls the shop API of the mock server
// (e2e/mocks/routes/http-tools.mjs, reachable over http on this machine because the e2e app runs with
// ALLOW_LOCAL_HTTP_TOOLS=true), tries it with «Probar», switches it on for an agent and the agent calls it in «Probar
// agente» (the simulated model calls a tool whose name the customer writes, with the «nombre=valor» pairs of the message,
// and quotes its answer). The secret header reaches the service but never the page. Deleting it warns about the agent.
import { randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import { chatRequests } from "../support/ai";
import { agentPath, createNamedAgent, replyDetails, sendTestMessage, testChatLog, uniqueAgentName } from "../support/agents";
import { authStatePath } from "../support/app";
import { MOCK_URL } from "../support/env";
import { chooseOption } from "../support/forms";
import { uniqueRef } from "../support/names";
import { expect, test } from "../support/test";
import { clickAndWaitForPost } from "../support/ui";

test.use({ storageState: authStatePath("owner") });

const TOOLS_PATH = "/agentes/herramientas";
const TOOL_URL = /\/agentes\/herramientas\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

type ServiceRequest = { method: string; path: string; headers: Record<string, string> };

/** What the shop API of the mock received (its recorded requests, e2e/mocks/server.mjs). */
async function shopRequests(): Promise<ServiceRequest[]> {
  const response = await fetch(`${MOCK_URL}/__requests?service=http-tools`);
  const body = (await response.json()) as { requests: ServiceRequest[] };
  return body.requests;
}

/** Nothing of the page (HTML, the React payload, attributes) carries the secret. */
async function expectNoSecret(page: Page, secret: string): Promise<void> {
  expect(await page.content(), "the secret header must never reach the page").not.toContain(secret);
}

test.describe("with the OpenRouter key", () => {
  test("[HER-11][HER-12][HER-14][AGE-08][PRU-02] a tool is created, tried, used by the agent in «Probar agente» and deleted with a warning; its secret header never reaches the page", async ({
    page,
    mock,
    openRouterKey,
  }, testInfo) => {
    test.setTimeout(180_000);
    expect(openRouterKey).toBeTruthy();
    const toolName = `pedido_${uniqueRef(testInfo, "herramienta http")}`;
    const secret = `e2e-clave-${randomBytes(12).toString("hex")}`;
    const agentName = uniqueAgentName(testInfo, "Agente de pedidos");

    await test.step("[HER-11][HER-12] create it: name, description, one parameter, GET to the mock with {numero}, a secret header", async () => {
      await page.goto(`${TOOLS_PATH}/nueva`);
      await page.getByLabel("Nombre", { exact: true }).first().fill(toolName);
      await page.getByLabel("Descripción para la IA", { exact: true }).fill("Consulta el estado de un pedido de la tienda por su número.");
      await page.getByRole("button", { name: "Añadir dato" }).click();
      const parameter = page.getByRole("group", { name: "Dato 1" });
      await parameter.getByLabel("Nombre", { exact: true }).fill("numero");
      await parameter.getByLabel("Descripción (opcional)", { exact: true }).fill("Número del pedido");
      await expect(parameter.getByRole("checkbox", { name: "Obligatorio" })).toBeChecked();
      await chooseOption(page, page.getByRole("combobox", { name: "Método" }), "GET");
      await page.getByLabel("Dirección", { exact: true }).fill(`${MOCK_URL}/http-tools/pedidos/{numero}`);
      await page.getByRole("button", { name: "Añadir cabecera" }).click();
      const header = page.getByRole("group", { name: "Cabecera 1" });
      await header.getByLabel("Nombre", { exact: true }).fill("X-Api-Key");
      await header.getByLabel("Valor", { exact: true }).fill(secret);
      await clickAndWaitForPost(page, page.getByRole("button", { name: "Crear herramienta" }));
      await expect(page).toHaveURL(TOOL_URL);
      await expect(page.getByRole("heading", { level: 1, name: toolName })).toBeVisible();
      // Saved: only the mask and «Cambiar».
      await expect(page.getByRole("group", { name: "Cabecera 1" }).getByText(`••••${secret.slice(-4)}`)).toBeVisible();
      await expect(page.getByRole("group", { name: "Cabecera 1" }).getByRole("button", { name: "Cambiar" })).toBeVisible();
      await expectNoSecret(page, secret);
    });

    await test.step("[HER-11][HER-12] «Probar» runs on the server: status, time and the answer; the header reached the service, not the page", async () => {
      await page.getByLabel("numero", { exact: true }).fill("42");
      await clickAndWaitForPost(page, page.getByRole("button", { name: "Probar", exact: true }));
      const result = page.getByRole("region", { name: "Resultado" });
      await expect(result).toContainText("Correcto · 200");
      await expect(result).toContainText(/\d+ ms/);
      await expect(result).toContainText("En reparto");
      await expectNoSecret(page, secret);
      const calls = await shopRequests();
      expect(calls.map(({ method, path }) => `${method} ${path}`)).toEqual(["GET /pedidos/42"]);
      expect(calls[0].headers["x-api-key"]).toBe(secret);
    });

    await test.step("[AGE-08] switched on in the agent's Herramientas tab", async () => {
      const agentId = await createNamedAgent(page, agentName);
      await page.goto(agentPath(agentId, "herramientas"));
      const toolSwitch = page.getByRole("switch", { name: toolName });
      await expect(toolSwitch).not.toBeChecked();
      await clickAndWaitForPost(page, toolSwitch);
      await expect(page.getByText(`Este agente ya puede usar «${toolName}».`)).toBeVisible();
      await expect(toolSwitch).toBeChecked();

      await test.step("[PRU-01][PRU-02] in «Probar agente» the agent calls it and answers with what it returned", async () => {
        await page.goto(agentPath(agentId, "probar"));
        await sendTestMessage(page, `¿Cómo va mi pedido? Consulta ${toolName} numero=42`);
        const log = testChatLog(page);
        await expect(log).toContainText(`Resultado de ${toolName}:`);
        await expect(log).toContainText("En reparto");
        const details = replyDetails(page);
        await expect(details).toContainText(toolName);
        await expect(details).toContainText("En reparto");
        await expectNoSecret(page, secret);
        // The model was offered the tool with its parameters, and never the secret.
        const requests = await chatRequests(mock);
        const offered = JSON.stringify(requests.map((request) => request.body));
        expect(offered).toContain(toolName);
        expect(offered).not.toContain(secret);
        const calls = await shopRequests();
        expect(calls).toHaveLength(2);
        expect(calls[1].headers["x-api-key"]).toBe(secret);
      });
    });

    await test.step("[AGE-08] deleting it says which agent uses it; afterwards the agent no longer has it", async () => {
      await page.goto(TOOLS_PATH);
      const row = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: toolName, exact: true }) });
      await expect(row).toContainText(agentName);
      await row.getByRole("button", { name: `Borrar ${toolName}` }).click();
      const confirm = page.getByRole("alertdialog");
      await expect(confirm).toContainText(`La usan ${agentName}`);
      await clickAndWaitForPost(page, confirm.getByRole("button", { name: "Borrar", exact: true }));
      await expect(page.getByRole("link", { name: toolName, exact: true })).toHaveCount(0);
    });
  });
});
