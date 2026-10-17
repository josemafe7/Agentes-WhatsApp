import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { channels, contactIdentities, contacts } from "@/db/schema";
import { InstagramApiError } from "@/lib/instagram/errors";
import { createChannel, createContactWithIdentity } from "@/test/factories";
import { connectedAccountRoutes, fakeInstagramFetch, IG_TEST, igError, igOk } from "@/test/fixtures/instagram";
import type { ChannelRecord } from "../types";
import { encryptInstagramSecrets } from "./config";
import { runInstagramProfile } from "./profile";

let channel: ChannelRecord;
const secretsEnc = () => encryptInstagramSecrets({ accessToken: IG_TEST.accessToken, appSecret: IG_TEST.appSecret, metaAppSecret: null, verifyToken: IG_TEST.verifyToken });
const payload = () => ({ channelId: channel.id, userId: IG_TEST.customer.id });

function instagram(profile: () => Response) {
  const fake = fakeInstagramFetch(connectedAccountRoutes({ "GET user": profile }));
  return { calls: fake.calls, deps: fake.deps };
}

const reloadContact = async (id: string) => (await db.select().from(contacts).where(eq(contacts.id, id)))[0];
const reloadIdentity = async (id: string) => (await db.select().from(contactIdentities).where(eq(contactIdentities.id, id)))[0];

beforeEach(async () => {
  await db.delete(contactIdentities);
  await db.delete(contacts);
  await db.delete(channels);
  channel = await createChannel({ type: "instagram", status: "connected", config: { accountId: IG_TEST.accountId }, secretsEnc: secretsEnc() });
});

describe("ig.profile: the name of someone new [IG-08]", () => {
  it("fills the contact's name and shows «@usuario» on the identity, which still identifies by its id [IG-08] [CAN-13]", async () => {
    const { contact, identity } = await createContactWithIdentity("instagram", { externalId: IG_TEST.customer.id, name: null });
    const { calls, deps } = instagram(() => igOk({ name: "Ana Pruebas", username: "ana_pruebas" }));
    expect(await runInstagramProfile(payload(), deps)).toBe("done");
    expect(calls[0]).toMatchObject({ route: IG_TEST.customer.id });
    expect(await reloadContact(contact.id)).toMatchObject({ name: "Ana Pruebas", searchText: "ana pruebas" });
    expect(await reloadIdentity(identity.id)).toMatchObject({ displayName: "@ana_pruebas", externalId: IG_TEST.customer.id });
  });

  it("without a name, the contact is called by its «@usuario» [IG-08]", async () => {
    const { contact } = await createContactWithIdentity("instagram", { externalId: IG_TEST.customer.id, name: null });
    const { deps } = instagram(() => igOk({ name: null, username: "ana_pruebas" }));
    await runInstagramProfile(payload(), deps);
    expect((await reloadContact(contact.id)).name).toBe("@ana_pruebas");
  });

  it("a name the team wrote is never overwritten [IG-08]", async () => {
    const { contact, identity } = await createContactWithIdentity("instagram", { externalId: IG_TEST.customer.id, name: "Ana (clienta de los martes)" });
    const { deps } = instagram(() => igOk({ name: "Ana Pruebas", username: "ana_pruebas" }));
    expect(await runInstagramProfile(payload(), deps)).toBe("done");
    expect((await reloadContact(contact.id)).name).toBe("Ana (clienta de los martes)");
    expect((await reloadIdentity(identity.id)).displayName).toBe("@ana_pruebas");
  });

  it("a failure is not fatal: the contact keeps no name; a passing one is left to the queue's retries [IG-08]", async () => {
    const { contact } = await createContactWithIdentity("instagram", { externalId: IG_TEST.customer.id, name: null });
    expect(await runInstagramProfile(payload(), instagram(() => igError(100, 2534014)).deps)).toBe("failed");
    expect((await reloadContact(contact.id)).name).toBeNull();
    await expect(runInstagramProfile(payload(), instagram(() => igError(4, undefined, 400)).deps)).rejects.toBeInstanceOf(InstagramApiError);
  });

  it("someone unknown, a demo channel or one without its token is skipped without calling Instagram [ARR-11]", async () => {
    const { calls, deps } = instagram(() => igOk({ name: "X" }));
    expect(await runInstagramProfile(payload(), deps)).toBe("skipped");
    await createContactWithIdentity("instagram", { externalId: IG_TEST.customer.id, name: null });
    const demo = await createChannel({ type: "instagram", isDemo: true, secretsEnc: secretsEnc() });
    expect(await runInstagramProfile({ channelId: demo.id, userId: IG_TEST.customer.id }, deps)).toBe("skipped");
    const disconnected = await createChannel({ type: "instagram", secretsEnc: null });
    expect(await runInstagramProfile({ channelId: disconnected.id, userId: IG_TEST.customer.id }, deps)).toBe("skipped");
    expect(calls).toHaveLength(0);
  });
});
