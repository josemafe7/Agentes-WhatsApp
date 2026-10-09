// The three ways of connecting a WhatsApp number ([WA-53]–[WA-56], [YC-01]–[YC-04], [YC-09], [YC-10], [QR-01]): Añadir
// canal shows them side by side with the WhatsApp logo and what tells them apart; the YCloud wizard connects a number
// with the account's key against the simulated YCloud; and the QR code wizard does not go on until its risk notice is
// accepted (the code itself is never asked for here: that would open a real connection to WhatsApp).
import { authStatePath } from "../support/app";
import { CHANNELS_PATH } from "../support/channels";
import { uniqueName } from "../support/names";
import { expect, test } from "../support/test";
import { expectChannelState, expectLight } from "../support/whatsapp";
import { checkKey, connectYCloudNumber, disconnectYCloudNumber, disconnectYCloudQuietly, NEW_YCLOUD_PATH, revokedKey, testYCloudAccount } from "../support/ycloud";

test.use({ storageState: authStatePath("owner") });

const NEW_CHANNEL_PATH = "/canales/nuevo";
const NEW_QR_PATH = "/canales/nuevo/whatsapp-qr";

test("[WA-53] Añadir canal shows the three ways of connecting WhatsApp, each to its own wizard", async ({ page }) => {
  await page.goto(NEW_CHANNEL_PATH);
  const main = page.getByRole("main");
  const whatsapp = main.getByRole("region", { name: "WhatsApp" });
  await expect(whatsapp.getByRole("listitem").filter({ has: page.getByRole("heading", { level: 3 }) })).toHaveCount(3);
  await expect(whatsapp.getByRole("link", { name: "WhatsApp: API oficial de Meta" })).toHaveAttribute("href", "/canales/nuevo/whatsapp");
  await expect(whatsapp.getByRole("link", { name: "WhatsApp: YCloud · coexistencia" })).toHaveAttribute("href", NEW_YCLOUD_PATH);
  await expect(whatsapp.getByRole("link", { name: "WhatsApp: Código QR · no oficial" })).toHaveAttribute("href", NEW_QR_PATH);
  // What tells them apart is said on each card, and the unofficial one is marked as such.
  await expect(whatsapp.getByText("Recomendada")).toBeVisible();
  await expect(whatsapp.getByText("No oficial", { exact: true })).toBeVisible();
  await expect(whatsapp.getByText("El número sigue funcionando en la app WhatsApp Business del móvil.")).toBeVisible();
  await expect(whatsapp.getByText(/pueden bloquear el número/)).toBeVisible();
  await whatsapp.getByText("Comparar las tres formas").click();
  await expect(whatsapp.getByRole("rowheader", { name: "¿Es la API oficial?" })).toBeVisible();
  // The other channels are still there.
  for (const name of ["Chat web", "Correo", "Telegram"]) await expect(main.getByRole("region", { name: "Otros canales" }).getByRole("link", { name })).toBeVisible();
});

test("[YC-01][YC-02][YC-03][YC-04][YC-09][YC-10][WA-54][WA-56] the YCloud wizard checks the key, connects the number in test mode and its panel says how it is", async ({ page, mock }, testInfo) => {
  test.setTimeout(150_000);
  const account = testYCloudAccount(testInfo, uniqueName(testInfo, "WhatsApp YCloud e2e"));
  let channelId: string | null = null;
  try {
    // [YC-01] What has to be done before in YCloud is right there; [YC-04] and here, without a public address, it says so.
    await page.goto(NEW_YCLOUD_PATH);
    await expect(page.getByRole("heading", { name: "Antes de empezar, en YCloud" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Abrir la consola de YCloud/ })).toHaveAttribute("href", "https://www.ycloud.com/console/");
    await expect(page.getByText(/Estás en local: podrás comprobar la clave, pero no llegarán mensajes/)).toBeVisible();

    // [YC-02] A key YCloud refuses says why and offers nothing to connect.
    await checkKey(page, revokedKey(account));
    await expect(page.getByText(/YCloud no acepta la clave de API/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Conectar número" })).toBeDisabled();

    // [YC-02] The right key lists the account's number, with its name and state.
    await checkKey(page, account.apiKey);
    await expect(page.getByText("YCloud acepta la clave")).toBeVisible();
    await expect(page.getByRole("radio", { name: new RegExp(account.verifiedName) })).toBeChecked();
    await expect(page.getByText("Estado: Conectado · Calidad: Alta")).toBeVisible();

    // [YC-03] Connected: the key is nowhere on the screen, and the number starts in test mode ([WA-56]).
    channelId = await connectYCloudNumber(page, account);
    expect(await page.content()).not.toContain(account.apiKey);
    await expect(page.getByRole("heading", { name: "WhatsApp · YCloud (coexistencia)" })).toBeVisible();
    await expect(page.getByText(new RegExp(account.verifiedName)).first()).toBeVisible();
    await expectLight(page, "Clave de YCloud", "ok");
    await expectLight(page, "Número", "ok");
    await expectLight(page, "Saldo", "ok");
    // [YC-04] Without a public address YCloud was not asked to call anywhere, and the panel says what to do.
    await expectLight(page, "Avisos", "warn");
    await expect(page.getByText("Todavía no recibe mensajes")).toBeVisible();
    expect(await mock.requests({ service: "ycloud", method: "POST", path: "/v2/webhookEndpoints" })).toHaveLength(0);
    await expect(page.getByText("Modo pruebas").first()).toBeVisible();

    // [YC-09] «Sincronizar plantillas» brings the account's templates.
    await page.getByRole("button", { name: "Sincronizar plantillas" }).click();
    await expect(page.getByText("1 plantilla sincronizada.")).toBeVisible();

    // [WA-54] The card says how the number is connected; [WA-11] the same number is not connected twice.
    await page.goto(CHANNELS_PATH);
    await expect(page.getByRole("main").getByText(new RegExp(`WhatsApp · YCloud · ${account.displayPhoneNumber.replace(/[+]/g, "\\+")}`))).toBeVisible();
    await checkKey(page, account.apiKey);
    await expect(page.getByText("Ya está conectado en otro canal de esta instalación.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Conectar número" })).toBeDisabled();

    // [YC-10] «Desconectar»: the key is deleted and the channel keeps its history, disabled.
    await disconnectYCloudNumber(page, channelId, account.channelName);
    await expect(page.getByText("Este número está desconectado")).toBeVisible();
    // It comes back through its own wizard, keeping its channel ([WA-54]).
    await expect(page.getByRole("link", { name: "Volver a conectar este número" })).toHaveAttribute("href", new RegExp(`${NEW_YCLOUD_PATH}\\?canal=${channelId}`));
    await expectChannelState(page, account.channelName, /Desactivado/);
    channelId = null;
  } finally {
    await disconnectYCloudQuietly(page, channelId, account.channelName);
  }
});

test("[QR-01] the QR code wizard does not go on until its risk notice is accepted", async ({ page }) => {
  await page.goto(NEW_QR_PATH);
  await expect(page.getByText("Esta forma de conectar no es oficial")).toBeVisible();
  await expect(page.getByText(/pueden bloquear el número, unos días o para siempre/)).toBeVisible();
  const generate = page.getByRole("button", { name: "Generar código QR" });
  await expect(generate).toBeDisabled();
  await page.getByRole("checkbox", { name: /acepto el riesgo de que WhatsApp bloquee este número/ }).check();
  await expect(generate).toBeEnabled();
  // The code itself is never asked for in a test: that would open a real connection to WhatsApp.
});

test("[PER-04] only owner and admin reach the YCloud and QR code wizards", async ({ browser }, testInfo) => {
  for (const role of ["supervisor", "agent", "viewer"] as const) {
    const context = await browser.newContext({ storageState: authStatePath(role), baseURL: testInfo.project.use.baseURL });
    const page = await context.newPage();
    for (const path of [NEW_YCLOUD_PATH, NEW_QR_PATH]) {
      await page.goto(path);
      await expect(page.getByText("No tienes permiso para ver esta sección")).toBeVisible();
    }
    await expect(page.getByLabel("Clave de API de YCloud")).toHaveCount(0);
    await context.close();
  }
});
