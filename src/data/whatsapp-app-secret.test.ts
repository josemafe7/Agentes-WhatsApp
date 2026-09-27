// «Cambiar App Secret» ([WA-52]): when Meta rotates it, the new App Secret only replaces the old one if Meta confirms it,
// and it is stored encrypted, also for the other numbers of the same Meta app (their webhooks are signed with it).
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditLog, channels } from "@/db/schema";
import { encryptWhatsAppSecrets, readWhatsAppSecrets } from "@/server/channels/whatsapp/config";
import { actorFor, createBusiness, createChannel } from "@/test/factories";
import { WA_TEST } from "@/test/fixtures/whatsapp";
import { connectedNumberRoutes, FAKE_META_BASE_URL, fakeMetaFetch, metaError, type MetaHandler } from "@/test/fixtures/whatsapp/fake-meta";
import { changeWhatsAppAppSecret } from "./whatsapp";

const owner = actorFor("owner");
const NEW_APP_SECRET = "nuevo_app_secret_rotado_1234";

const deps = (handler: MetaHandler = connectedNumberRoutes()) => ({ fetchImpl: fakeMetaFetch(handler).fetch, baseUrl: FAKE_META_BASE_URL });

const whatsappChannel = (name: string, phoneNumberId: string) =>
  createChannel({
    type: "whatsapp",
    name,
    status: "connected",
    phoneNumberId,
    wabaId: WA_TEST.wabaId,
    metaAppId: WA_TEST.appId,
    graphApiVersion: "v26.0",
    secretsEnc: encryptWhatsAppSecrets({ accessToken: WA_TEST.accessToken, appSecret: WA_TEST.appSecret, twoStepPin: null }),
  });

const appSecretOf = async (id: string) => readWhatsAppSecrets((await db.select().from(channels).where(eq(channels.id, id)))[0])?.appSecret;

let number: Awaited<ReturnType<typeof whatsappChannel>>;
let sibling: Awaited<ReturnType<typeof whatsappChannel>>;

beforeEach(async () => {
  await db.delete(auditLog);
  await db.delete(channels);
  await createBusiness();
  number = await whatsappChannel("Recepción", WA_TEST.phoneNumberId);
  // Another number of the same Meta app shares its App Secret.
  sibling = await whatsappChannel("Tienda", "200000000000555");
});

describe("«Cambiar App Secret» [WA-52]", () => {
  it("an App Secret Meta rejects never replaces the one that works, here or in the other numbers of the app", async () => {
    // Meta refuses the app token (App ID|App Secret): the App Secret is wrong.
    const view = await changeWhatsAppAppSecret(owner, number.id, { appSecret: NEW_APP_SECRET }, deps(connectedNumberRoutes({ "GET /debug_token": () => metaError(190, 400) })));
    expect(view).toMatchObject({ ok: false, field: "appSecret", error: "El App ID o el App Secret no son correctos, o el token es de otra app." });
    expect(await appSecretOf(number.id)).toBe(WA_TEST.appSecret);
    expect(await appSecretOf(sibling.id)).toBe(WA_TEST.appSecret);
    expect(await db.select().from(auditLog)).toEqual([]);
  });

  it("one Meta confirms replaces it, encrypted, in every number of the same app", async () => {
    const view = await changeWhatsAppAppSecret(owner, number.id, { appSecret: NEW_APP_SECRET }, deps());
    expect(view.ok).toBe(true);
    expect(JSON.stringify(view)).not.toContain(NEW_APP_SECRET);
    for (const id of [number.id, sibling.id]) {
      expect(await appSecretOf(id)).toBe(NEW_APP_SECRET);
      const [row] = await db.select({ secretsEnc: channels.secretsEnc }).from(channels).where(eq(channels.id, id));
      expect(row.secretsEnc).not.toContain(NEW_APP_SECRET);
    }
    expect((await db.select({ action: auditLog.action }).from(auditLog)).map((entry) => entry.action)).toEqual(["channel.app_secret_changed"]);
  });

  it("an App Secret that is too short is refused before asking Meta, and nothing changes", async () => {
    await expect(changeWhatsAppAppSecret(owner, number.id, { appSecret: "corto" }, deps())).rejects.toMatchObject({ status: 400 });
    expect(await appSecretOf(number.id)).toBe(WA_TEST.appSecret);
  });
});
