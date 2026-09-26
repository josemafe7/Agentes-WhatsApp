// Agentes and the agent editor ([AGE-01]–[AGE-06], [AGE-08], [AGE-12], [AGE-13], [AGE-15], [HER-10]) and who may do
// what with them («Quién puede hacer qué»: [PER-01], [PER-03], [PER-04]). Each test creates the agents it needs with a
// name of its own, so it does not depend on the demo agents or on other tests.
import type { Browser, TestInfo } from "@playwright/test";
import {
  agentCard,
  agentPath,
  AGENTS_PATH,
  createAgentFromTemplate,
  createNamedAgent,
  deleteAgentFromList,
  DEMO_TEMPLATE,
  EDITOR_TABS,
  expectSaved,
  generateDraftFromDescription,
  instructionField,
  NEW_AGENT_PATH,
  openVersion,
  renameAgent,
  restoreVersion,
  saveButton,
  saveEditor,
  sendTestMessage,
  testChatLog,
  testMessageBox,
  uniqueAgentName,
  unsavedChangesBar,
  versionEntry,
  type EditorTab,
} from "../support/agents";
import { CHAT_COMPLETIONS_PATH, chatRequests, messageText } from "../support/ai";
import { authStatePath, newPersonContext } from "../support/app";
import { clientIpFor, expect, test } from "../support/test";
import { clickAndWaitForPost, escapeRegExp, expectRefused, pathPattern } from "../support/ui";
import { DEMO_USERS, type RoleKey } from "../support/users";

/** Sectors of [ASI-03]: the demo is a hair salon, so the others are offered as «Plantilla de otro sector». */
const OTHER_SECTORS = ["Clínica dental", "Clínica/Fisioterapia", "Restaurante", "Taller", "Academia/Clases", "Inmobiliaria", "Tienda", "Otro"];

/** Another person, signed in on their own browser (the demo sessions of auth.setup.ts). */
async function openAs(role: RoleKey, browser: Browser, testInfo: TestInfo) {
  const context = await newPersonContext(browser, testInfo, {
    clientIp: clientIpFor(`${testInfo.testId}:${testInfo.retry}:${role}`),
    storageState: authStatePath(role),
  });
  return { context, page: await context.newPage() };
}

/** An agent of the owner with two versions (created, then renamed), for the tests of other roles. */
async function ownerAgentWithTwoVersions(browser: Browser, testInfo: TestInfo, name: string): Promise<string> {
  const owner = await openAs("owner", browser, testInfo);
  try {
    const agentId = await createNamedAgent(owner.page, `${name} (borrador)`);
    await renameAgent(owner.page, agentId, name);
    return agentId;
  } finally {
    await owner.context.close();
  }
}

test.describe("as the demo owner", () => {
  test.use({ storageState: authStatePath("owner") });

  test("[AGE-01][AGE-02][AGE-03] an agent is created from the template of the sector, has every tab of the editor and shows up in Agentes", async ({
    page,
  }, testInfo) => {
    await page.goto(AGENTS_PATH);
    await page.getByRole("link", { name: "Nuevo agente" }).click();
    await expect(page).toHaveURL(pathPattern(NEW_AGENT_PATH));

    // [AGE-02] A template for every sector, and «En blanco».
    await expect(page.getByRole("radio", { name: /En blanco/ })).toBeVisible();
    await page.getByRole("radio", { name: /otro sector/i }).check();
    await page.getByRole("combobox", { name: "Sector" }).click();
    for (const sector of OTHER_SECTORS) await expect(page.getByRole("option", { name: sector, exact: true }), sector).toBeVisible();
    await page.keyboard.press("Escape");

    const name = uniqueAgentName(testInfo);
    const agentId = await createAgentFromTemplate(page, { name });
    await expect(page.getByLabel("Nombre", { exact: true })).toHaveValue(name);

    // [AGE-03] Every tab has its own address.
    const tabs = page.getByRole("navigation", { name: "Secciones del agente" });
    const shownTabs: EditorTab[] = ["general", "instrucciones", "modelo", "herramientas", "traspaso", "canales", "probar", "versiones"];
    for (const tab of shownTabs) {
      await expect(tabs.getByRole("link", { name: EDITOR_TABS[tab].label, exact: true }), `tab ${EDITOR_TABS[tab].label}`).toHaveAttribute(
        "href",
        agentPath(agentId, tab),
      );
    }

    // [AGE-02][AGE-04] The template brings the guided instructions of the sector.
    await tabs.getByRole("link", { name: "Instrucciones", exact: true }).click();
    await expect(page).toHaveURL(pathPattern(agentPath(agentId, "instrucciones")));
    await expect(instructionField(page, "Rol")).toHaveValue(DEMO_TEMPLATE.roleMentions);
    for (const label of ["Información del negocio", "Qué puede hacer", "Qué no puede hacer", "Estilo", "Cuándo pasar a una persona"]) {
      await expect(instructionField(page, label), label).not.toHaveValue("");
    }

    // [AGE-01] The list shows it with its model.
    await page.goto(AGENTS_PATH);
    const card = agentCard(page, name);
    await expect(card).toBeVisible();
    await expect(card, "the card shows the model").toContainText(/[a-z0-9-]+\/[a-z0-9.:-]+/);
    await card.getByRole("link", { name, exact: true }).click();
    await expect(page).toHaveURL(pathPattern(agentPath(agentId)));
  });

  test("[AGE-04][AGE-12] saving the instructions makes a new version with its author, and restoring an older one saves it as a new version", async ({
    page,
  }, testInfo) => {
    const agentId = await createAgentFromTemplate(page);
    const newRole = `Eres la recepción de pruebas ${uniqueAgentName(testInfo, "e2e")}: atiendes dudas de la peluquería.`;

    await page.goto(agentPath(agentId, "instrucciones"));
    const role = instructionField(page, "Rol");
    const templateRole = await role.inputValue();
    expect(templateRole).toMatch(DEMO_TEMPLATE.roleMentions);
    await role.fill(newRole);
    await expect(unsavedChangesBar(page)).toBeVisible();
    await saveEditor(page);
    await expectSaved(page);
    await page.reload();
    await expect(instructionField(page, "Rol")).toHaveValue(newRole);

    await page.goto(agentPath(agentId, "versiones"));
    await expect(versionEntry(page, 2)).toContainText(DEMO_USERS.owner.name);
    await expect(versionEntry(page, 1)).toContainText(DEMO_USERS.owner.name);

    // Restoring never rewrites history: version 1 comes back as version 3 ([AGE-12]).
    await restoreVersion(page, agentId, 1);
    await expect(versionEntry(page, 3)).toBeVisible();
    await expect(versionEntry(page, 3)).toContainText(DEMO_USERS.owner.name);
    await expect(versionEntry(page, 2)).toBeVisible();

    await page.goto(agentPath(agentId, "instrucciones"));
    await expect(instructionField(page, "Rol")).toHaveValue(templateRole);
  });

  test("[AGE-05] «Generar borrador con IA» proposes instructions from a description, and nothing is saved until «Guardar cambios»", async ({
    page,
    mock,
    openRouterKey,
  }, testInfo) => {
    expect(openRouterKey).toBeTruthy();
    const agentId = await createAgentFromTemplate(page);
    await page.goto(agentPath(agentId, "instrucciones"));
    const templateRole = await instructionField(page, "Rol").inputValue();
    const description = `Peluquería de barrio ${uniqueAgentName(testInfo, "e2e")}: cortes, color y peinados para toda la familia.`;

    await generateDraftFromDescription(page, description);
    // The simulated model repeats the description in the role it proposes.
    await expect(instructionField(page, "Rol")).toHaveValue(new RegExp(escapeRegExp(description.slice(0, 40))));
    await expect(unsavedChangesBar(page)).toBeVisible();
    const [request] = await chatRequests(mock);
    expect(messageText(request.body.messages.at(-1)), "the description goes to the model as data").toContain(description);
    expect(request.body.provider?.data_collection).toBe("deny");

    // Not saved: leaving and coming back shows the template again.
    page.once("dialog", (dialog) => void dialog.accept());
    await page.reload();
    await expect(instructionField(page, "Rol")).toHaveValue(templateRole);

    // Generated again and saved: now it stays, as a new version.
    await generateDraftFromDescription(page, description);
    const draftRole = await instructionField(page, "Rol").inputValue();
    expect(draftRole).not.toBe(templateRole);
    await saveEditor(page);
    await expectSaved(page);
    await page.reload();
    await expect(instructionField(page, "Rol")).toHaveValue(draftRole);
    await page.goto(agentPath(agentId, "versiones"));
    await expect(versionEntry(page, 2)).toBeVisible();
  });

  test("[AGE-15] an agent without a name is not saved and the error is shown next to the field", async ({ page }) => {
    const agentId = await createAgentFromTemplate(page);
    await page.goto(agentPath(agentId));
    const nameField = page.getByLabel("Nombre", { exact: true });
    await nameField.fill("");
    await saveButton(page).click();
    await expect(nameField).toHaveAttribute("aria-invalid", "true");
    await expect(unsavedChangesBar(page), "the changes stay there, unsaved").toBeVisible();

    // Nothing was saved (leaving with unsaved changes asks first: the answer is «leave»).
    page.once("dialog", (dialog) => void dialog.accept());
    await page.goto(agentPath(agentId, "versiones"));
    await expect(versionEntry(page, 1)).toBeVisible();
    await expect(versionEntry(page, 2)).toHaveCount(0);
    await page.goto(agentPath(agentId));
    await expect(page.getByLabel("Nombre", { exact: true })).toHaveValue(DEMO_TEMPLATE.agentName);
  });

  test("[AGE-06][MOT-06][MOT-07] «Vista previa del prompt» shows the whole text with the platform rules first", async ({ page }) => {
    const agentId = await createAgentFromTemplate(page);
    await page.goto(agentPath(agentId, "instrucciones"));
    const role = await instructionField(page, "Rol").inputValue();
    await page.getByRole("button", { name: "Vista previa del prompt" }).click();
    const preview = page.getByRole("dialog", { name: "Vista previa del prompt" });
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("Instrucciones del agente");
    const text = (await preview.innerText()).replace(/\s+/g, " ");
    const rulesAt = text.indexOf("Reglas de la plataforma");
    const roleAt = text.indexOf(role.replace(/\s+/g, " ").slice(0, 60));
    expect(rulesAt, "the platform rules are in the preview").toBeGreaterThanOrEqual(0);
    expect(roleAt, "the agent's own instructions come after them").toBeGreaterThan(rulesAt);
  });

  test("[HER-10][AGE-08] in this phase the agent only has the hand-off tool; the others are «Próximamente»", async ({ page }) => {
    const agentId = await createAgentFromTemplate(page);
    await page.goto(agentPath(agentId, "herramientas"));
    const main = page.getByRole("main");
    await expect(main.getByRole("switch", { name: "Pasar a una persona" })).toBeChecked();
    for (const label of ["Buscar en el conocimiento", "Consultar huecos libres", "Crear citas"]) {
      await expect(main.getByRole("switch", { name: label }), `${label} is not available yet`).toBeDisabled();
    }
    await expect(main.getByText("Próximamente").first()).toBeVisible();
  });

  test("[AGE-13] deleting an agent asks for confirmation and removes it from Agentes", async ({ page }, testInfo) => {
    const name = uniqueAgentName(testInfo, "Agente para borrar");
    const agentId = await createNamedAgent(page, name);
    await page.goto(AGENTS_PATH);
    await expect(agentCard(page, name)).toBeVisible();

    const confirm = await deleteAgentFromList(page, name);
    await expect(confirm).toContainText(name);
    await clickAndWaitForPost(page, confirm.getByRole("button", { name: /^Borrar/ }));
    await expect(agentCard(page, name)).toHaveCount(0);

    const response = await page.goto(agentPath(agentId));
    expect(response?.status() ?? 0).toBeLessThan(500);
    await expect(page.getByRole("heading", { level: 1, name })).toHaveCount(0);
  });
});

test.describe("who may do what with agents", () => {
  test("[PER-03][PER-01] the viewer sees agents and their versions but cannot change, create, restore or test them", async ({ browser }, testInfo) => {
    const name = uniqueAgentName(testInfo, "Agente visible");
    const agentId = await ownerAgentWithTwoVersions(browser, testInfo, name);

    const viewer = await openAs("viewer", browser, testInfo);
    const view = viewer.page;
    await view.goto(AGENTS_PATH);
    await expect(agentCard(view, name)).toBeVisible();
    await expect(view.getByRole("link", { name: "Nuevo agente" })).toHaveCount(0);
    await expect(agentCard(view, name).getByRole("button", { name: /acciones/i })).toHaveCount(0);

    await view.goto(agentPath(agentId));
    await expect(view.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(view.getByRole("main").getByText("Solo lectura", { exact: true })).toBeVisible();
    await expect(view.getByRole("main").getByRole("textbox")).toHaveCount(0);
    await expect(view.getByRole("navigation", { name: "Secciones del agente" }).getByRole("link", { name: "Probar", exact: true })).toHaveCount(0);

    await view.goto(agentPath(agentId, "instrucciones"));
    await expect(view.getByRole("main").getByText(DEMO_TEMPLATE.roleMentions).first()).toBeVisible();
    await expect(view.getByRole("main").getByRole("textbox")).toHaveCount(0);

    await openVersion(view, agentId, 1);
    await expect(versionEntry(view, 2)).toBeVisible();
    await expect(view.getByRole("button", { name: /^Restaurar/ })).toHaveCount(0);

    await expectRefused(view, NEW_AGENT_PATH);
    await expectRefused(view, agentPath(agentId, "probar"));
    await viewer.context.close();
  });

  test("[PER-04][PRU-01] the supervisor sees the editor read-only but can test the agent in Probar", async ({ browser, mock, openRouterKey }, testInfo) => {
    expect(openRouterKey).toBeTruthy();
    const name = uniqueAgentName(testInfo, "Agente supervisado");
    const agentId = await ownerAgentWithTwoVersions(browser, testInfo, name);

    const supervisor = await openAs("supervisor", browser, testInfo);
    const view = supervisor.page;
    await view.goto(agentPath(agentId));
    await expect(view.getByRole("main").getByText("Solo lectura", { exact: true })).toBeVisible();
    await expect(view.getByRole("main").getByRole("textbox")).toHaveCount(0);
    await openVersion(view, agentId, 1);
    await expect(view.getByRole("button", { name: /^Restaurar/ })).toHaveCount(0);
    await expectRefused(view, NEW_AGENT_PATH);

    await view.goto(agentPath(agentId));
    await view.getByRole("navigation", { name: "Secciones del agente" }).getByRole("link", { name: "Probar", exact: true }).click();
    await expect(view).toHaveURL(pathPattern(agentPath(agentId, "probar")));
    await expect(testMessageBox(view)).toBeEnabled();
    await sendTestMessage(view, "Hola, ¿tenéis cita mañana?");
    await expect(testChatLog(view)).toContainText(`Soy ${name}`);
    expect(await mock.requests({ service: "openrouter", method: "POST", path: CHAT_COMPLETIONS_PATH })).toHaveLength(1);
    await supervisor.context.close();
  });

  test("[PER-04][SEG-04] the agent role cannot open agents, not even by their address", async ({ browser }, testInfo) => {
    const owner = await openAs("owner", browser, testInfo);
    const agentId = await createAgentFromTemplate(owner.page);
    await owner.context.close();

    const agent = await openAs("agent", browser, testInfo);
    for (const path of [AGENTS_PATH, NEW_AGENT_PATH, agentPath(agentId), agentPath(agentId, "probar"), agentPath(agentId, "versiones")]) {
      await expectRefused(agent.page, path);
    }
    await agent.context.close();
  });
});
