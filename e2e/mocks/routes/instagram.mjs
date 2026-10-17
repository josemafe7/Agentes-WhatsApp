// Instagram API with Instagram Login default answers (docs/integracion-instagram.md). INSTAGRAM_GRAPH_BASE_URL points at
// <mock>/instagram, so paths keep the real «/v25.0/…» shape (any version) and errors are Graph's `{ error: { message,
// type, code, error_subcode?, fbtrace_id } }`.
//
// Accounts: any token «prueba.<account id>.<letters>» is a professional account of its own (the user name is
// «prueba_<account id>»); a token whose last part starts with «REVOCADO» is one Instagram no longer takes (190). Each
// test uses its own account (e2e/support/instagram.ts).
//
// What the specs can rely on (per-test errors with POST /__stub, e.g. a 10/2534022 on POST /v25.0/me/messages):
//   GET  /:v/me?fields=…                  the account: user_id, id, username, name, account_type «Business» (§2.3).
//   POST /:v/me/subscribed_apps            { success: true } (§4.4).
//   POST /:v/me/messages                   text only: a text over 1,000 bytes → 100; a recipient that is not digits →
//                                          100/2534014; else { recipient_id, message_id } with a new mid per call. When
//                                          the account has a webhook (below), Meta's echo of that message (same mid,
//                                          is_echo) is POSTed to it right after, signed (§8).
//   GET  /refresh_access_token?grant_type=ig_refresh_token&access_token=…  the same token for 60 more days (§2.2).
//   GET  /:v/:IGSID?fields=name,username   «Cliente <last 4 digits>» and «cliente_<IGSID>» (§9).
//   GET  /cdn/:file                         a customer's file (the app downloads only from Instagram's hosts or this
//                                          base): «.jpg» a tiny JPEG, «.mp4»/«.m4a» a tiny M4A voice note, «.pdf» a PDF.
//   POST /dashboard/accounts/:accountId/webhook   NOT Graph: what a person does in the app dashboard, «Verify and save»
//                                          with `{ callback_url, verify_token, app_secret }`: Meta's GET verification is
//                                          made to callback_url DURING the request; when it works, the account keeps
//                                          that address and the secret Meta signs with. Answers { success, verification }.
//   POST /dashboard/accounts/:accountId/messages  NOT Graph: what a customer does in Instagram, a DM to the account.
//                                          Body `{ from: { id }, text?, attachment?: { type, file? }, mid?, callback_url?,
//                                          app_secret? }` (the last two only to use another address or secret than the
//                                          saved ones). The webhook is POSTed signed; answers { mid, delivered: status }.
//   POST /dashboard/accounts/:accountId/replies   NOT Graph: the business writes from the Instagram app: an echo with a
//                                          new mid to `{ to: { id }, text }` ([IG-06]).
//   POST /dashboard/accounts/:accountId/deletions NOT Graph: the customer deletes their message `{ from: { id }, mid }`
//                                          ([IG-07]).
import { createHmac } from "node:crypto";

const TOKEN = /^prueba\.(\d{1,32})\.([A-Za-z0-9_-]{1,200})$/;
const VERSION = /^v\d{1,3}\.\d{1,2}$/;
const NODE = /^\d{1,32}$/;
const MAX_TEXT_BYTES = 1000;
const SIXTY_DAYS_S = 60 * 24 * 60 * 60;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const M4A = Buffer.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, 0, 0, 0, 0, 1, 2, 3, 4]);
const PDF = Buffer.from("%PDF-1.7\n%prueba e2e\n");

// ─── State (process lifetime; every test uses an account of its own) ────────────────────────────────────

/** @type {Map<string, { webhook: { url: string, appSecret: string } | null, nextMid: number }>} */
const accounts = new Map();

function stateOf(accountId) {
  let state = accounts.get(accountId);
  if (!state) {
    state = { webhook: null, nextMid: 1 };
    accounts.set(accountId, state);
  }
  return state;
}

const newMid = (accountId, state) => `aWdfZTJl${accountId.slice(-6)}${String(state.nextMid++).padStart(6, "0")}`;
const ok = (body, status = 200) => ({ status, body });
const graphError = (status, code, subcode, message = "Error simulado") => ({
  status,
  body: { error: { message, type: "OAuthException", code, ...(subcode ? { error_subcode: subcode } : {}), fbtrace_id: "AE2eSimulado" } },
});
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/** The account of the request's token (Bearer, or `access_token` in the query for the renewal), or Graph's error. */
function authorize(headers, query) {
  const bearer = /^Bearer (.+)$/.exec(headers.authorization ?? "")?.[1] ?? query.access_token ?? "";
  const match = TOKEN.exec(bearer);
  if (!match || match[2].startsWith("REVOCADO")) return { failure: graphError(401, 190, undefined, "Invalid OAuth access token - Cannot parse access token") };
  return { accountId: match[1], token: bearer, state: stateOf(match[1]) };
}

/** A Graph route: the handler gets the account, its state and the request. */
function graph(method, path, handle) {
  return {
    method,
    path,
    handle: (request) => {
      const version = request.path.split("/")[1];
      if (path.startsWith("/:v/") && !VERSION.test(version)) return graphError(400, 2500, undefined, "Unknown path components");
      const auth = authorize(request.headers, request.query);
      if (auth.failure) return auth.failure;
      return handle({ ...auth, request });
    },
  };
}

const sign = (body, secret) => `sha256=${createHmac("sha256", secret).update(Buffer.from(body, "utf8")).digest("hex")}`;

/** POSTs a webhook body to the account's address, signed like Meta; answers the status the app gave. */
async function deliver(url, appSecret, body) {
  const text = JSON.stringify(body);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": sign(text, appSecret) },
      body: text,
      signal: AbortSignal.timeout(20_000),
    });
    return response.status;
  } catch {
    return 0;
  }
}

const envelope = (accountId, messaging) => ({ object: "instagram", entry: [{ id: accountId, time: Date.now(), messaging: [messaging] }] });

/**
 * Meta's verification of a webhook address (docs/integracion-instagram.md §4.2): GET with hub.mode, hub.challenge and
 * hub.verify_token; it works when the answer is 200 with the challenge as it was sent.
 */
async function verifyCallback(callbackUrl, verifyToken) {
  let url;
  try {
    url = new URL(callbackUrl);
  } catch {
    return { status: 0, echoed: false };
  }
  const challenge = String(1_000_000_000 + Math.floor(Math.random() * 999_999_999));
  url.searchParams.set("hub.mode", "subscribe");
  url.searchParams.set("hub.challenge", challenge);
  url.searchParams.set("hub.verify_token", verifyToken);
  try {
    const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(10_000) });
    const text = await response.text();
    return { status: response.status, echoed: response.status === 200 && text === challenge };
  } catch {
    return { status: 0, echoed: false };
  }
}

function sendMessage({ accountId, state, request }) {
  const body = isRecord(request.body) ? request.body : {};
  const recipient = isRecord(body.recipient) ? String(body.recipient.id ?? "") : "";
  const message = isRecord(body.message) ? body.message : {};
  if (!NODE.test(recipient)) return graphError(400, 100, 2534014, "No matching user found");
  if (typeof message.text !== "string" || message.text.length === 0) return graphError(400, 100, undefined, "Invalid parameter");
  if (Buffer.byteLength(message.text, "utf8") > MAX_TEXT_BYTES) return graphError(400, 100, undefined, "Message text is too long");
  const mid = newMid(accountId, state);
  const webhook = state.webhook;
  // Instagram echoes every message the account sends, the app's own included (§8).
  if (webhook) {
    setTimeout(() => {
      void deliver(webhook.url, webhook.appSecret, envelope(accountId, { sender: { id: accountId }, recipient: { id: recipient }, timestamp: Date.now(), message: { mid, text: message.text, is_echo: true } }));
    }, 50);
  }
  return ok({ recipient_id: recipient, message_id: mid });
}

/** The account's id of a dashboard path, and its body. */
function dashboard(request) {
  const accountId = /^\/dashboard\/accounts\/(\d{1,32})\//.exec(request.path)?.[1] ?? null;
  return { accountId, input: isRecord(request.body) ? request.body : {} };
}

/** Where a dashboard action delivers: the saved address and secret, or the ones the body names. */
function targetOf(state, input) {
  const url = typeof input.callback_url === "string" ? input.callback_url : state.webhook?.url;
  const appSecret = typeof input.app_secret === "string" ? input.app_secret : state.webhook?.appSecret;
  return url && appSecret ? { url, appSecret } : null;
}

const noWebhook = () => ok({ error: "La cuenta no tiene dirección de avisos: «Verify and save» primero, o pasa callback_url y app_secret" }, 409);

async function customerWrites(request) {
  const { accountId, input } = dashboard(request);
  const from = isRecord(input.from) ? String(input.from.id ?? "") : "";
  if (!accountId || !NODE.test(from)) return ok({ error: "from.id (dígitos) hace falta" }, 400);
  const state = stateOf(accountId);
  const target = targetOf(state, input);
  if (!target) return noWebhook();
  const mid = typeof input.mid === "string" && input.mid ? input.mid : newMid(accountId, state);
  const message = { mid };
  if (typeof input.text === "string" && input.text) message.text = input.text;
  if (isRecord(input.attachment)) {
    const type = String(input.attachment.type ?? "image");
    const file = String(input.attachment.file ?? (type === "audio" ? "nota.m4a" : type === "file" ? "documento.pdf" : "foto.jpg")).replace(/[^A-Za-z0-9._-]/g, "");
    const base = `http://${request.headers.host ?? "127.0.0.1:3101"}/instagram`;
    message.attachments = [{ type, payload: { url: `${base}/cdn/${file}` } }];
  }
  const delivered = await deliver(target.url, target.appSecret, envelope(accountId, { sender: { id: from }, recipient: { id: accountId }, timestamp: Date.now(), message }));
  return ok({ mid, delivered });
}

async function businessReplies(request) {
  const { accountId, input } = dashboard(request);
  const to = isRecord(input.to) ? String(input.to.id ?? "") : "";
  if (!accountId || !NODE.test(to) || typeof input.text !== "string") return ok({ error: "to.id (dígitos) y text hacen falta" }, 400);
  const state = stateOf(accountId);
  const target = targetOf(state, input);
  if (!target) return noWebhook();
  const mid = newMid(accountId, state);
  const delivered = await deliver(target.url, target.appSecret, envelope(accountId, { sender: { id: accountId }, recipient: { id: to }, timestamp: Date.now(), message: { mid, text: input.text, is_echo: true } }));
  return ok({ mid, delivered });
}

async function customerDeletes(request) {
  const { accountId, input } = dashboard(request);
  const from = isRecord(input.from) ? String(input.from.id ?? "") : "";
  if (!accountId || !NODE.test(from) || typeof input.mid !== "string") return ok({ error: "from.id (dígitos) y mid hacen falta" }, 400);
  const target = targetOf(stateOf(accountId), input);
  if (!target) return noWebhook();
  const delivered = await deliver(target.url, target.appSecret, envelope(accountId, { sender: { id: from }, recipient: { id: accountId }, timestamp: Date.now(), message: { mid: input.mid, is_deleted: true } }));
  return ok({ mid: input.mid, delivered });
}

/** @type {import("../server.mjs").MockRoute[]} */
export const instagramRoutes = [
  {
    // What a person does in the app dashboard: «Verify and save» the URL and the verify token (§4.1).
    method: "POST",
    path: "/dashboard/accounts/:accountId/webhook",
    handle: async (request) => {
      const { accountId, input } = dashboard(request);
      if (!accountId || typeof input.callback_url !== "string" || typeof input.verify_token !== "string" || typeof input.app_secret !== "string") {
        return ok({ success: false, error: "Faltan callback_url, verify_token y app_secret" }, 400);
      }
      const verification = await verifyCallback(input.callback_url, input.verify_token);
      if (verification.echoed) stateOf(accountId).webhook = { url: input.callback_url, appSecret: input.app_secret };
      return ok({ success: verification.echoed, verification });
    },
  },
  { method: "POST", path: "/dashboard/accounts/:accountId/messages", handle: customerWrites },
  { method: "POST", path: "/dashboard/accounts/:accountId/replies", handle: businessReplies },
  { method: "POST", path: "/dashboard/accounts/:accountId/deletions", handle: customerDeletes },
  {
    method: "GET",
    path: "/cdn/:file",
    handle: ({ path }) => {
      const name = path.split("/").pop() ?? "";
      if (name.endsWith(".pdf")) return { status: 200, body: PDF, headers: { "content-type": "application/pdf" } };
      if (name.endsWith(".m4a") || name.endsWith(".mp4")) return { status: 200, body: M4A, headers: { "content-type": "audio/mp4" } };
      return { status: 200, body: JPEG, headers: { "content-type": "image/jpeg" } };
    },
  },
  graph("GET", "/refresh_access_token", ({ token, request }) =>
    request.query.grant_type === "ig_refresh_token" ? ok({ access_token: token, token_type: "bearer", expires_in: SIXTY_DAYS_S }) : graphError(400, 100, undefined, "Invalid grant_type"),
  ),
  graph("GET", "/:v/me", ({ accountId }) => ok({ user_id: accountId, id: `9${accountId.slice(-15)}`, username: `prueba_${accountId}`, name: `Cuenta de prueba ${accountId.slice(-4)}`, account_type: "Business" })),
  graph("POST", "/:v/me/subscribed_apps", () => ok({ success: true })),
  graph("POST", "/:v/me/messages", sendMessage),
  graph("GET", "/:v/:node", ({ request }) => {
    const node = request.path.split("/")[2] ?? "";
    if (!NODE.test(node)) return graphError(400, 100, undefined, "Unsupported get request");
    return ok({ name: `Cliente ${node.slice(-4)}`, username: `cliente_${node}` });
  }),
];
