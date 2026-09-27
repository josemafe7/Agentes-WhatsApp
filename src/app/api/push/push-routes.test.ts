import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ session: null as null | { session: { id: string }; user: { id: string } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/server/auth", () => ({ auth: { api: { getSession: async () => state.session } } }));

import { db } from "@/db";
import { integrationSettings, pushSubscriptions, rateLimits, userRoles } from "@/db/schema";
import { createBusiness, createUser, type TestUser } from "@/test/factories";
import { GET as getIcon, runtime as iconRuntime } from "./icon/route";
import { GET as getPublicKey, runtime as publicKeyRuntime } from "./public-key/route";
import { DELETE as removeDevice, runtime as deviceRuntime } from "./subscriptions/[id]/route";
import { DELETE as unsubscribe, POST as subscribe, runtime as subscriptionsRuntime } from "./subscriptions/route";

const APP = "http://localhost:3000";
const CHROME_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

let owner: TestUser;
let agent: TestUser;

const signIn = (user: TestUser | null) => {
  state.session = user ? { session: { id: `s-${user.userId}` }, user: { id: user.userId } } : null;
};

function browserSubscription() {
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/${randomBytes(12).toString("hex")}`,
    expirationTime: null,
    keys: { p256dh: Buffer.concat([Buffer.from([4]), randomBytes(64)]).toString("base64url"), auth: randomBytes(16).toString("base64url") },
  };
}

function jsonRequest(method: "POST" | "DELETE", path: string, body: unknown, origin: string | null = APP): Request {
  const headers = new Headers({ "content-type": "application/json", "user-agent": CHROME_WINDOWS });
  if (origin) headers.set("origin", origin);
  return new Request(`${APP}${path}`, { method, headers, body: typeof body === "string" ? body : JSON.stringify(body) });
}

const post = (body: unknown, origin?: string | null) => subscribe(jsonRequest("POST", "/api/push/subscriptions", body, origin));
const turnOff = (body: unknown, origin?: string | null) => unsubscribe(jsonRequest("DELETE", "/api/push/subscriptions", body, origin));
const remove = (id: string, origin: string | null = APP) =>
  removeDevice(jsonRequest("DELETE", `/api/push/subscriptions/${id}`, "", origin), { params: Promise.resolve({ id }) });

beforeEach(async () => {
  await db.delete(pushSubscriptions);
  await db.delete(rateLimits);
  await db.delete(userRoles);
  await createBusiness({ contactEmail: "hola@peluqueria.test" });
  owner = await createUser("owner");
  agent = await createUser("agent");
  signIn(null);
});

describe("/api/push/public-key [PWA-03]", () => {
  it("runs on Node and needs a session", async () => {
    expect(publicKeyRuntime).toBe("nodejs");
    expect((await getPublicKey()).status).toBe(401);
  });

  it("gives the installation's public VAPID key, never the private one", async () => {
    signIn(agent);
    const response = await getPublicKey();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const body = (await response.json()) as Record<string, unknown>;
    const [settings] = await db.select().from(integrationSettings);
    expect(body).toEqual({ publicKey: settings.vapidPublicKey });
  });
});

describe("/api/push/subscriptions [PWA-03]", () => {
  it("runs on Node", () => {
    expect(subscriptionsRuntime).toBe("nodejs");
    expect(deviceRuntime).toBe("nodejs");
  });

  it("needs a session", async () => {
    expect((await post(browserSubscription())).status).toBe(401);
    expect((await turnOff({ endpoint: browserSubscription().endpoint })).status).toBe(401);
    expect(await db.select().from(pushSubscriptions)).toHaveLength(0);
  });

  it("only takes requests from the app's own pages [SEG-06]", async () => {
    signIn(agent);
    expect((await post(browserSubscription(), "https://malo.example")).status).toBe(403);
    expect((await post(browserSubscription(), null)).status).toBe(403);
    expect(await db.select().from(pushSubscriptions)).toHaveLength(0);
  });

  it("validates what the browser sends [SEG-05]", async () => {
    signIn(agent);
    expect((await post({ ...browserSubscription(), endpoint: "http://10.0.0.1/push" })).status).toBe(400);
    expect((await post("{no es json")).status).toBe(400);
    expect((await post({ endpoint: browserSubscription().endpoint })).status).toBe(400);
    expect(await db.select().from(pushSubscriptions)).toHaveLength(0);
  });

  it("only takes a subscription of a browser's push service: the server would POST to it", async () => {
    signIn(agent);
    for (const endpoint of ["https://push.example.com/fcm/send/abc", "https://push.invalid/e2e/abc", "https://attacker.example.org/w/?token=abc"]) {
      expect((await post({ ...browserSubscription(), endpoint })).status, endpoint).toBe(400);
    }
    expect(await db.select().from(pushSubscriptions)).toHaveLength(0);
  });

  it("stores the device for the signed-in person and answers without the endpoint", async () => {
    signIn(agent);
    const subscription = browserSubscription();
    const response = await post(subscription);
    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["fingerprint", "id"]);
    expect(JSON.stringify(body)).not.toContain(subscription.endpoint);
    const rows = await db.select().from(pushSubscriptions);
    expect(rows).toEqual([expect.objectContaining({ id: body.id, userId: agent.userId, endpoint: subscription.endpoint, userAgent: CHROME_WINDOWS })]);
  });

  it("nobody turns off or removes someone else's device", async () => {
    signIn(owner);
    const subscription = browserSubscription();
    const { id } = (await (await post(subscription)).json()) as { id: string };

    signIn(agent);
    expect((await turnOff({ endpoint: subscription.endpoint })).status).toBe(404);
    expect((await remove(id)).status).toBe(404);
    expect(await db.select().from(pushSubscriptions)).toHaveLength(1);

    signIn(owner);
    expect((await remove(id, "https://malo.example")).status).toBe(403);
    expect((await remove("no-es-un-id")).status).toBe(400);
    expect((await remove(id)).status).toBe(200);
    expect(await db.select().from(pushSubscriptions)).toHaveLength(0);
  });

  it("turning push off on this device deletes it", async () => {
    signIn(agent);
    const subscription = browserSubscription();
    expect((await post(subscription)).status).toBe(201);
    expect((await turnOff({ endpoint: subscription.endpoint })).status).toBe(200);
    expect(await db.select().from(pushSubscriptions)).toHaveLength(0);
  });
});

describe("/api/push/icon [PWA-01]", () => {
  it("draws the business icon as a PNG, without a session (the browser installs the app with it)", async () => {
    expect(iconRuntime).toBe("nodejs");
    const response = await getIcon(new Request(`${APP}/api/push/icon?size=192`));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Array.from(bytes.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it("only the sizes of the manifest", async () => {
    expect((await getIcon(new Request(`${APP}/api/push/icon?size=4096`))).status).toBe(400);
    expect((await getIcon(new Request(`${APP}/api/push/icon`))).status).toBe(400);
  });
});
