// The simulated Instagram of the e2e run (e2e/mocks/routes/instagram.mjs) and what a customer and Meta do there: test
// accounts and customers, Meta's «Verify and save» of the webhook address, a customer's DM, an answer the business
// writes from the Instagram app, a deleted message, and what the app sent. Connecting through the wizard lives with the
// wizard's own helpers. Each test uses an account of its own: any token «prueba.<account id>.<letters>» is an account
// for the simulated Instagram.
import { createHash, createHmac } from "node:crypto";
import type { APIRequestContext, APIResponse, TestInfo } from "@playwright/test";
import { MOCK_URL, RUN_ID } from "./env";
import type { MockClient, MockRecordedRequest } from "./mock-client";

export type TestInstagramAccount = {
  /** `user_id` of /me: what the webhooks carry in `entry[].id`. */
  accountId: string;
  token: string;
  username: string;
  channelName: string;
  /** The Instagram app secret pasted in the wizard: Meta signs the webhooks with it in the simulated Instagram. */
  appSecret: string;
};
export type TestInstagramCustomer = { id: string };

function digits(testInfo: TestInfo, label: string, length: number): string {
  const hash = createHash("sha256").update(`${RUN_ID}:${testInfo.testId}:${testInfo.retry}:${label}`).digest("hex");
  return String(parseInt(hash.slice(0, 12), 16) % 10 ** length).padStart(length, "1");
}

/** Tokens and secrets are put together at runtime: no literal in the repository may look like a real key. */
const tokenOf = (accountId: string, secret = "PRUEBAE2E0") => ["prueba", accountId, secret.repeat(4)].join(".");

/** An Instagram account only this test uses. */
export function testInstagramAccount(testInfo: TestInfo, channelName: string): TestInstagramAccount {
  const accountId = `1784${digits(testInfo, `ig:${channelName}`, 13)}`;
  return { accountId, token: tokenOf(accountId), username: `prueba_${accountId}`, channelName, appSecret: ["secreto", "ig", RUN_ID, digits(testInfo, `secret:${channelName}`, 8)].join("_") };
}

/** The token of the same account once Instagram no longer takes it (190). */
export const revokedInstagramToken = (account: TestInstagramAccount) => tokenOf(account.accountId, "REVOCADO00");

/** A customer (their Instagram-scoped id) only this test uses. */
export function testInstagramCustomer(testInfo: TestInfo, label: string): TestInstagramCustomer {
  return { id: `11${digits(testInfo, `customer:${label}`, 14)}` };
}

/** The channel's webhook address in the app under test (`baseURL` of the project). */
export function instagramWebhookAddress(baseURL: string, channelId: string): string {
  return `${baseURL.replace(/\/+$/, "")}/api/webhooks/instagram/${channelId}`;
}

async function dashboard(request: APIRequestContext, account: TestInstagramAccount, action: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await request.post(`${MOCK_URL}/instagram/dashboard/accounts/${account.accountId}/${action}`, { data, failOnStatusCode: false });
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok()) throw new Error(`The simulated Instagram refused «${action}»: ${response.status()} ${JSON.stringify(body)}`);
  return body;
}

/**
 * «Verify and save» in the app dashboard: Meta checks the address with the verify token the app shows, and from then on
 * signs what it sends there with the account's app secret. Returns whether the app echoed the challenge.
 */
export async function verifyInstagramWebhook(request: APIRequestContext, account: TestInstagramAccount, options: { callbackUrl: string; verifyToken: string }): Promise<boolean> {
  const body = await dashboard(request, account, "webhook", { callback_url: options.callbackUrl, verify_token: options.verifyToken, app_secret: account.appSecret });
  return body.success === true;
}

export type InstagramDm = { text?: string; attachment?: { type: "image" | "audio" | "file" | "video" | "story_mention"; file?: string }; mid?: string };
type Delivery = { mid: string; delivered: number };
/** Another address or secret than the ones saved with «Verify and save» (e.g. a wrong secret, to see it refused). */
type DeliveryOptions = { callbackUrl?: string; appSecret?: string };

const deliveryTarget = (options: DeliveryOptions) => ({ ...(options.callbackUrl ? { callback_url: options.callbackUrl } : {}), ...(options.appSecret ? { app_secret: options.appSecret } : {}) });

/** What a customer does in Instagram: a DM to the account. Meta POSTs it to the app, signed; `delivered` is the app's status. */
export async function customerWritesOnInstagram(
  request: APIRequestContext,
  account: TestInstagramAccount,
  customer: TestInstagramCustomer,
  dm: string | InstagramDm,
  options: DeliveryOptions = {},
): Promise<Delivery> {
  const message = typeof dm === "string" ? { text: dm } : dm;
  return (await dashboard(request, account, "messages", { from: { id: customer.id }, ...message, ...deliveryTarget(options) })) as Delivery;
}

/** The business answers from the Instagram app itself: Meta sends the app an echo ([IG-06]). */
export async function businessRepliesOnInstagram(request: APIRequestContext, account: TestInstagramAccount, customer: TestInstagramCustomer, text: string, options: DeliveryOptions = {}): Promise<Delivery> {
  return (await dashboard(request, account, "replies", { to: { id: customer.id }, text, ...deliveryTarget(options) })) as Delivery;
}

/** The customer deletes one of their messages ([IG-07]). */
export async function customerDeletesOnInstagram(request: APIRequestContext, account: TestInstagramAccount, customer: TestInstagramCustomer, mid: string, options: DeliveryOptions = {}): Promise<Delivery> {
  return (await dashboard(request, account, "deletions", { from: { id: customer.id }, mid, ...deliveryTarget(options) })) as Delivery;
}

/** «sha256=<hex>» of these bytes, as Meta sends it in X-Hub-Signature-256. */
export function signInstagramWebhook(body: string, appSecret: string): string {
  return `sha256=${createHmac("sha256", appSecret).update(Buffer.from(body, "utf8")).digest("hex")}`;
}

/** POSTs any body to the channel's webhook like Meta: its signature with `appSecret`, another header, or none (`null`). */
export async function postInstagramWebhook(request: APIRequestContext, url: string, body: string, signature: { appSecret: string } | string | null): Promise<APIResponse> {
  const header = signature === null ? null : typeof signature === "string" ? signature : signInstagramWebhook(body, signature.appSecret);
  return request.post(url, { data: Buffer.from(body, "utf8"), headers: { "content-type": "application/json", ...(header ? { "x-hub-signature-256": header } : {}) }, failOnStatusCode: false });
}

/** The calls the app made with this account's token to a Graph path (relative to the version: «me», «me/messages»…). */
export async function instagramCalls(mock: MockClient, account: TestInstagramAccount, method: "GET" | "POST", path: string): Promise<MockRecordedRequest[]> {
  const requests = await mock.requests({ service: "instagram", method, path: `/*/${path}` });
  return requests.filter((call) => call.headers.authorization === `Bearer ${account.token}`);
}

/** The DMs the app sent through the account: `{ recipient, text }`. */
export async function sentByInstagramAccount(mock: MockClient, account: TestInstagramAccount): Promise<{ recipient: string; text: string }[]> {
  return (await instagramCalls(mock, account, "POST", "me/messages"))
    .filter((call) => call.status === 200)
    .map((call) => {
      const body = call.body as { recipient?: { id?: string }; message?: { text?: string } };
      return { recipient: String(body.recipient?.id ?? ""), text: String(body.message?.text ?? "") };
    });
}
