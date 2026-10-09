// WhatsApp through YCloud as the team uses it ([YC-*]) and the simulated YCloud of the e2e run
// (e2e/mocks/routes/ycloud.mjs). Locators follow docs/pantallas.md («Asistente de WhatsApp · YCloud», «Panel del canal»)
// and src/app/(app)/canales/nuevo/whatsapp-ycloud and src/app/(app)/canales/[id]/_ycloud, so a change of wording is
// fixed here:
//   /canales/nuevo/whatsapp-ycloud   Paso 1: «Clave de API de YCloud» and «Comprobar clave»; then «YCloud acepta la
//                                    clave», the numbers of the account (radio), «Nombre del canal», «Agente activo»,
//                                    «IA del canal» and «Conectar número». Paso 2: «… está conectado».
//   /canales/[id]                    the YCloud panel: «WhatsApp · YCloud (coexistencia)», a traffic light per check
//                                    («Clave de YCloud», «Número», «Avisos», «Saldo», «Último mensaje»), «Revalidar»,
//                                    «Cambiar clave», «Sincronizar plantillas» and «Desconectar» (name to confirm).
// Each test uses a YCloud account of its own: any key «yc<9 digits><letters>» is one, with one number.
import { createHash } from "node:crypto";
import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import { CHANNELS_PATH } from "./channels";
import { RUN_ID } from "./env";
import { clickAndWaitForPost } from "./ui";

export const NEW_YCLOUD_PATH = "/canales/nuevo/whatsapp-ycloud";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const CHANNEL_PANEL_URL = new RegExp(`/canales/(${UUID})(?:[/?#]|$)`);

export type TestYCloudAccount = { id: string; apiKey: string; phoneNumber: string; displayPhoneNumber: string; verifiedName: string; channelName: string };

function digits(testInfo: TestInfo, label: string, length: number): string {
  const hash = createHash("sha256").update(`${RUN_ID}:${testInfo.testId}:${testInfo.retry}:${label}`).digest("hex");
  return String(parseInt(hash.slice(0, 12), 16) % 10 ** length).padStart(length, "1");
}

/** Keys are put together at runtime: no literal in the repository may look like a real key to secret scanners. */
const keyOf = (accountId: string, kind = "CLAVEDEPRUEBA") => ["yc", accountId, kind.repeat(2)].join("");

/** A YCloud account only this test uses, with its one WhatsApp number. */
export function testYCloudAccount(testInfo: TestInfo, channelName: string): TestYCloudAccount {
  const id = digits(testInfo, `ycloud:${channelName}`, 9);
  const local = `6${id.slice(0, 8)}`;
  return {
    id,
    apiKey: keyOf(id),
    phoneNumber: `+34${local}`,
    displayPhoneNumber: `+34 ${local.slice(0, 3)} ${local.slice(3, 5)} ${local.slice(5, 7)} ${local.slice(7, 9)}`,
    verifiedName: `Negocio de prueba ${id}`,
    channelName,
  };
}

/** A key of the same account YCloud no longer accepts. */
export const revokedKey = (account: TestYCloudAccount) => keyOf(account.id, "REVOCADA");

function main(page: Page): Locator {
  return page.getByRole("main");
}

export function ycloudPanelPath(channelId: string): string {
  return `${CHANNELS_PATH}/${channelId}`;
}

/** Paso 1: the key typed and «Comprobar clave» pressed. */
export async function checkKey(page: Page, apiKey: string): Promise<void> {
  await page.goto(NEW_YCLOUD_PATH);
  await main(page).getByLabel("Clave de API de YCloud").fill(apiKey);
  await clickAndWaitForPost(page, main(page).getByRole("button", { name: "Comprobar clave" }));
}

/** «… está conectado»: the heading of Paso 2. */
export function connectedHeading(page: Page, account: TestYCloudAccount): Locator {
  return main(page).getByRole("heading", { name: new RegExp(`${account.displayPhoneNumber.replace(/[+]/g, "\\+")}.* está conectado$`) });
}

/** Connects the account's number through the wizard and opens its panel; returns the channel's id. */
export async function connectYCloudNumber(page: Page, account: TestYCloudAccount): Promise<string> {
  await checkKey(page, account.apiKey);
  await expect(main(page).getByText("YCloud acepta la clave")).toBeVisible({ timeout: 20_000 });
  await main(page).getByLabel("Nombre del canal").fill(account.channelName);
  await clickAndWaitForPost(page, main(page).getByRole("button", { name: "Conectar número" }));
  await expect(connectedHeading(page, account)).toBeVisible({ timeout: 20_000 });
  await main(page).getByRole("link", { name: "Ir al panel del canal" }).click();
  await expect(page).toHaveURL(CHANNEL_PANEL_URL);
  const id = CHANNEL_PANEL_URL.exec(page.url())?.[1];
  if (!id) throw new Error(`No channel id in ${page.url()}`);
  return id;
}

/** «Desconectar» ([YC-10]): writes the channel's name to confirm. */
export async function disconnectYCloudNumber(page: Page, channelId: string, channelName: string): Promise<void> {
  await page.goto(ycloudPanelPath(channelId));
  await main(page).getByRole("button", { name: "Desconectar", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("textbox", { name: /^Escribe .* para confirmar/ }).fill(channelName);
  await clickAndWaitForPost(page, dialog.getByRole("button", { name: "Desconectar", exact: true }));
  await expect(dialog).toHaveCount(0);
}

/** Best effort, so a failed test never leaves its number connected. */
export async function disconnectYCloudQuietly(page: Page, channelId: string | null, channelName: string): Promise<void> {
  if (!channelId) return;
  try {
    await page.goto(ycloudPanelPath(channelId));
    if (await main(page).getByRole("button", { name: "Desconectar", exact: true }).isVisible()) await disconnectYCloudNumber(page, channelId, channelName);
  } catch {
    // The next test uses its own account anyway.
  }
}
