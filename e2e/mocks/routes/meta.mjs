// Meta Graph API default answers for the WhatsApp Cloud API (docs/integracion-whatsapp.md, docs/integracion-whatsapp-
// mensajes.md). META_GRAPH_BASE_URL points at <mock>/meta, so paths keep the real "/v26.0/…" shape (any version).
// Shapes, codes and messages copy the docs; test data (tokens, app, templates) is in ./meta-data.json, which the
// specs read too (e2e/support/whatsapp-meta.ts).
//
// Numbers: any Phone Number ID of 15 digits that starts with 2 belongs to the app. Its WABA is the same digits
// starting with 1 (200000000000042 → 100000000000042), its display number «+1 555-XXX-XXXX» comes from its last 7
// digits, and the app, portfolio and system user are those of meta-data.json. Each test uses its own number.
//
// What the specs can rely on (per-test errors and variants with POST /__stub, e.g. a 190 on GET /v26.0/<number>):
//   Tokens    Bearer = tokens.valid, .expiring (a system user token that expires in 30 days, [WA-07]) or .missingMessaging;
//             anything else → 401 with code 190 ([WA-09]). The app token (access_token=APP_ID|APP_SECRET in the
//             query) only for /debug_token and /{APP_ID}/subscriptions; a wrong one → 400 with code 190.
//   GET  /:v/debug_token                 the documented data (§3.3): SYSTEM_USER, never expires, both WhatsApp scopes,
//                                        no target_ids; tokens.invalid → is_valid false.
//   GET  /:v/:node?fields=…              only the fields asked for, plus id. A number (fields of §3.1): VERIFIED, name
//                                        APPROVED, quality GREEN, TIER_250, health AVAILABLE with WABA, BUSINESS and APP
//                                        entities; status PENDING until it is registered, CONNECTED after ([WA-17]);
//                                        webhook_configuration.application = the app's callback once set. A WABA
//                                        (account_review_status…, §3.4). Without fields: a medium (§10.2) whose url
//                                        points at this server, or 100 when the id is not a medium.
//   GET/POST /:v/:APP_ID/subscriptions   the app's webhook (§4.1). POST (form) makes Meta's GET verification to the
//                                        callback_url DURING the request, as Meta does, and only then answers success.
//   GET/POST/DELETE /:v/:WABA/subscribed_apps  §4.3; POST never takes override_callback_uri ([WA-15]: this mock refuses
//                                        it, louder than Meta). GET lists the app unless the WABA was unsubscribed.
//   POST /:v/:number/register | deregister | request_code | verify_code, POST /:v/:number {pin}   §5.2–§5.5.
//   GET  /:v/:WABA/message_templates     meta-data.json «templates» (2 approved: one NAMED, one POSITIONAL; one pending,
//                                        one rejected), paged by `limit` and the `after` cursor (§5.8).
//   POST /:v/:number/messages            «read» (+ typing_indicator) → success; any send → a new wamid per call, with
//                                        contacts[].wa_id for `to` or contacts[].user_id for `recipient` (§11.2).
//                                        Templates must be approved in that language (132001) with every variable
//                                        (132000). Text bodies up to 4,096 characters.
//   POST /:v/:number/media               multipart upload → { id } (§10.4).
//   GET  /whatsapp_business/attachments/?mid=…  the file itself, with the Bearer token only (§10.2). Media ids of the
//                                        shared fixtures (src/test/fixtures/whatsapp): 900000000000001 voice note (OGG),
//                                        …002 image (JPEG), …003 PDF, …004 video, …005 sticker; uploads too.
//   POST /dashboard/apps/:APP_ID/webhooks  NOT Graph: what a person does in the app dashboard («Verificar y guardar»
//                                        with the URL and the verify token, §4.2). Meta's GET verification is made to
//                                        callback_url; answers { success, verification: { status, echoed } } and, when it
//                                        worked, the app keeps that callback (as after the automatic subscription).
import { createHash, randomBytes, randomInt } from "node:crypto";
import { readFileSync } from "node:fs";

const DATA = JSON.parse(readFileSync(new URL("./meta-data.json", import.meta.url), "utf8"));
const APP_ID = DATA.appId;
const APP_TOKEN = `${DATA.appId}|${DATA.appSecret}`;
const USER_TOKENS = new Set([DATA.tokens.valid, DATA.tokens.expiring, DATA.tokens.missingMessaging]);
const NUMBER = /^2\d{14}$/;
const NODE = /^\d{1,32}$/;
const VERSION = /^v\d{1,3}\.\d{1,2}$/;
const DAY_S = 24 * 60 * 60;

// ─── State (process lifetime; every test uses numbers of its own) ───────────────────────────────────────

/** Numbers registered with register (and not deregistered since). */
const registered = new Set();
/** WABAs whose subscription of the app was deleted. */
const unsubscribedWabas = new Set();
/** The app's webhook subscription (one per app, §4.1), set by a verified subscription. */
let appSubscription = null;
let sequence = 0;

// ─── Files ───────────────────────────────────────────────────────────────────────────────────────────────

/** A 1×1 JPEG. */
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);
/** Starts like an OGG file; the app never decodes it (the simulated OpenRouter transcribes a fixed text). */
const OGG = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(124, 1)]);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n", "utf8");
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypmp42"), Buffer.alloc(112, 0)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([56, 0, 0, 0]), Buffer.from("WEBPVP8 "), Buffer.alloc(48, 0)]);

/** @type {Map<string, { bytes: Buffer, mimeType: string }>} */
const media = new Map([
  ["900000000000001", { bytes: OGG, mimeType: "audio/ogg; codecs=opus" }],
  ["900000000000002", { bytes: JPEG, mimeType: "image/jpeg" }],
  ["900000000000003", { bytes: PDF, mimeType: "application/pdf" }],
  ["900000000000004", { bytes: MP4, mimeType: "video/mp4" }],
  ["900000000000005", { bytes: WEBP, mimeType: "image/webp" }],
]);

// ─── Helpers ─────────────────────────────────────────────────────────────────────────────────────────────

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ok(body, status = 200) {
  return { status, body };
}

/** Graph's error body (docs/integracion-whatsapp.md §5.4 and docs/integracion-whatsapp-mensajes.md §11.3). */
function graphError(status, code, message, extra = {}) {
  return { status, body: { error: { message, type: "OAuthException", code, ...extra, fbtrace_id: `AE2E${randomBytes(8).toString("hex")}` } } };
}

/** A WhatsApp error with its `error_data.details`. */
function whatsappError(status, code, message, details) {
  return graphError(status, code, `(#${code}) ${message}`, { error_data: { messaging_product: "whatsapp", details } });
}

const invalidParameter = (name) => whatsappError(400, 100, "Invalid parameter", `Parameter '${name}' is invalid or missing.`);

function unsupportedGet(id) {
  return graphError(
    400,
    100,
    `Unsupported get request. Object with ID '${id}' does not exist, cannot be loaded due to missing permissions, or does not support this operation.`,
    { error_subcode: 33 },
  );
}

function bearer(headers) {
  const match = /^Bearer\s+(.+)$/i.exec(String(headers.authorization ?? "").trim());
  return match ? match[1].trim() : null;
}

/** The system user's token (§2.2): null when it is a test token, otherwise the 190 answer. */
function refuseUserToken(headers) {
  const token = bearer(headers);
  if (token && USER_TOKENS.has(token)) return null;
  // Code 190, subcode 467 = not valid (docs/integracion-whatsapp.md §3.1).
  return graphError(401, 190, "Invalid OAuth access token - Cannot parse access token", { error_subcode: 467 });
}

/** The app token (APP_ID|APP_SECRET in the query), only for /debug_token and /{APP_ID}/subscriptions. */
function refuseAppToken(query) {
  if (query.access_token === APP_TOKEN) return null;
  return graphError(400, 190, "Invalid OAuth access token signature.");
}

const wabaOf = (phoneNumberId) => `1${phoneNumberId.slice(1)}`;
const phoneOfWaba = (wabaId) => `2${wabaId.slice(1)}`;

/** «+1 555-XXX-XXXX» from the last 7 digits (the webhooks carry the same digits: «1555XXXXXXX»). */
export function displayNumberOf(phoneNumberId) {
  const tail = phoneNumberId.slice(-7);
  return `+1 555-${tail.slice(0, 3)}-${tail.slice(3)}`;
}

/** Only the fields asked for, plus id (Graph's behaviour). */
function pickFields(full, fieldsParam, defaults) {
  const wanted = fieldsParam ? String(fieldsParam).split(",").map((field) => field.trim()).filter(Boolean) : defaults;
  const body = { id: full.id };
  for (const field of wanted) if (full[field] !== undefined) body[field] = full[field];
  return body;
}

function numberBody(phoneNumberId, fields) {
  const wabaId = wabaOf(phoneNumberId);
  const full = {
    id: phoneNumberId,
    display_phone_number: displayNumberOf(phoneNumberId),
    verified_name: DATA.verifiedName,
    quality_rating: "GREEN",
    code_verification_status: "VERIFIED",
    name_status: "APPROVED",
    status: registered.has(phoneNumberId) ? "CONNECTED" : "PENDING",
    whatsapp_business_manager_messaging_limit: "TIER_250",
    health_status: {
      can_send_message: "AVAILABLE",
      entities: [
        { entity_type: "PHONE_NUMBER", id: phoneNumberId, can_send_message: "AVAILABLE" },
        { entity_type: "WABA", id: wabaId, can_send_message: "AVAILABLE" },
        { entity_type: "BUSINESS", id: DATA.businessId, can_send_message: "AVAILABLE" },
        { entity_type: "APP", id: APP_ID, can_send_message: "AVAILABLE" },
      ],
    },
    webhook_configuration: appSubscription ? { application: appSubscription.callback_url } : {},
  };
  return pickFields(full, fields, ["id", "display_phone_number", "verified_name", "quality_rating"]);
}

function wabaBody(wabaId, fields) {
  const full = {
    id: wabaId,
    name: DATA.wabaName,
    account_review_status: "APPROVED",
    business_verification_status: "NOT_VERIFIED",
    country: "ES",
    timezone_id: "13",
    currency: "USD",
    status: "ACTIVE",
  };
  return pickFields(full, fields, ["id", "name"]);
}

const WABA_FIELDS = new Set(["account_review_status", "business_verification_status", "timezone_id", "currency", "message_template_namespace", "ownership_type"]);
const NUMBER_FIELDS = new Set([
  "display_phone_number",
  "verified_name",
  "quality_rating",
  "code_verification_status",
  "name_status",
  "new_display_name",
  "new_name_status",
  "status",
  "whatsapp_business_manager_messaging_limit",
  "health_status",
  "webhook_configuration",
  "throughput",
]);

function mediaUrl(headers, mediaId) {
  // The mock's own address, as the app reaches it (META_GRAPH_BASE_URL): the Bearer token may go there.
  return `http://${headers.host}/meta/whatsapp_business/attachments/?mid=${mediaId}&ext=${Date.now()}&hash=e2e`;
}

function mediaBody(headers, mediaId, file) {
  return {
    messaging_product: "whatsapp",
    url: mediaUrl(headers, mediaId),
    mime_type: file.mimeType,
    sha256: createHash("sha256").update(file.bytes).digest("base64"),
    // A string in the reference (docs/integracion-whatsapp-mensajes.md §10.2).
    file_size: String(file.bytes.length),
    id: mediaId,
  };
}

function nextWamid() {
  sequence += 1;
  return `wamid.HBgM${Buffer.from(`e2e:${Date.now()}:${sequence}`).toString("base64url")}`;
}

function formOf(body) {
  if (typeof body === "string") return Object.fromEntries(new URLSearchParams(body));
  return isRecord(body) ? body : {};
}

/**
 * Meta's verification of a webhook address (docs/integracion-whatsapp-mensajes.md §2): GET with hub.mode, hub.challenge
 * and hub.verify_token; it works when the answer is 200 with the challenge as it was sent.
 */
async function verifyCallback(callbackUrl, verifyToken) {
  let url;
  try {
    url = new URL(callbackUrl);
  } catch {
    return { status: 0, echoed: false };
  }
  const challenge = String(randomInt(1_000_000_000, 2_000_000_000));
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

function subscriptionOf(form) {
  const fields = String(form.fields ?? "messages")
    .replace(/[[\]"\s]/g, "")
    .split(",")
    .filter(Boolean);
  return { object: "whatsapp_business_account", callback_url: String(form.callback_url), active: true, fields: fields.map((name) => ({ name, version: "v26.0" })) };
}

// ─── Templates (§5.8) and sends (§11) ───────────────────────────────────────────────────────────────────

function templatesPage(wabaId, query) {
  const limit = Math.min(Math.max(Number(query.limit) || 25, 1), 1_000);
  const start = query.after ? Number(Buffer.from(String(query.after), "base64url").toString("utf8")) || 0 : 0;
  const data = DATA.templates.slice(start, start + limit);
  const end = start + data.length;
  const cursor = (index) => Buffer.from(String(index)).toString("base64url");
  return {
    data,
    paging: {
      cursors: { before: cursor(start), after: cursor(end) },
      ...(end < DATA.templates.length ? { next: `https://graph.facebook.com/v26.0/${wabaId}/message_templates?limit=${limit}&after=${cursor(end)}` } : {}),
    },
  };
}

/** Variable names of a template's body: «nombre» for {{nombre}}, «1» for {{1}}. */
function bodyVariables(template) {
  const body = (template.components ?? []).find((component) => String(component.type).toUpperCase() === "BODY");
  return [...String(body?.text ?? "").matchAll(/{{\s*([\w]+)\s*}}/g)].map((match) => match[1]);
}

function checkTemplate(template) {
  if (!isRecord(template) || typeof template.name !== "string" || !isRecord(template.language) || typeof template.language.code !== "string") {
    return invalidParameter("template");
  }
  const found = DATA.templates.find((item) => item.name === template.name && item.language === template.language.code && item.status === "APPROVED");
  if (!found) {
    return whatsappError(404, 132001, "Template name does not exist in the translation", `template name (${template.name}) does not exist in ${template.language.code}`);
  }
  const variables = bodyVariables(found);
  const components = Array.isArray(template.components) ? template.components : [];
  const body = components.find((component) => isRecord(component) && String(component.type).toLowerCase() === "body");
  const parameters = isRecord(body) && Array.isArray(body.parameters) ? body.parameters : [];
  const named = found.parameter_format === "NAMED";
  const complete =
    parameters.length === variables.length &&
    parameters.every((parameter) => isRecord(parameter) && parameter.type === "text" && typeof parameter.text === "string" && parameter.text.length > 0) &&
    (!named || variables.every((name) => parameters.some((parameter) => parameter.parameter_name === name)));
  if (!complete) {
    return whatsappError(400, 132000, "Number of parameters does not match the expected number of params", "body: number of localizable_params does not match the expected number of params");
  }
  return null;
}

const SEND_TYPES = new Set(["text", "image", "audio", "document", "video", "sticker", "location", "contacts", "interactive", "template", "reaction"]);
const MEDIA_TYPES = new Set(["image", "audio", "document", "video", "sticker"]);

function sendMessage(body) {
  if (!isRecord(body) || body.messaging_product !== "whatsapp") return invalidParameter("messaging_product");
  // «Leído» and «escribiendo…» (§12).
  if (body.status === "read") {
    if (typeof body.message_id !== "string" || !body.message_id.startsWith("wamid.")) return whatsappError(400, 131009, "Parameter value is not valid", "Invalid message_id");
    if (body.typing_indicator !== undefined && !(isRecord(body.typing_indicator) && body.typing_indicator.type === "text")) return invalidParameter("typing_indicator");
    return ok({ success: true });
  }
  const to = typeof body.to === "string" && body.to.trim() ? body.to.trim() : null;
  const recipient = typeof body.recipient === "string" && body.recipient.trim() ? body.recipient.trim() : null;
  if (!to && !recipient) return invalidParameter("to");
  const type = String(body.type ?? "text");
  if (!SEND_TYPES.has(type) || !isRecord(body[type])) return invalidParameter("type");
  const content = body[type];
  if (type === "text" && (typeof content.body !== "string" || !content.body.trim() || content.body.length > 4_096)) return invalidParameter("text.body");
  if (MEDIA_TYPES.has(type) && Boolean(content.id) === Boolean(content.link)) return invalidParameter(`${type}.id`);
  if (type === "template") {
    const refused = checkTemplate(content);
    if (refused) return refused;
  }
  // `to` wins when both come (§11.1); the app never sends both.
  const contact = to ? { input: to, wa_id: to.replace(/\D/g, "") } : { input: recipient, user_id: recipient };
  return ok({ messaging_product: "whatsapp", contacts: [contact], messages: [{ id: nextWamid(), ...(type === "template" ? { message_status: "accepted" } : {}) }] });
}

// ─── Routes ──────────────────────────────────────────────────────────────────────────────────────────────

/** Segments after the version: "/v26.0/123/messages" → ["123", "messages"] (null when the version is not one). */
function graphPath(path) {
  const [, version, ...rest] = path.split("/");
  return VERSION.test(version ?? "") ? rest : null;
}

/** @type {import("../server.mjs").MockRoute[]} */
export const metaRoutes = [
  {
    // What a person does in the app dashboard: «Verificar y guardar» the URL and the verify token (§4.2).
    method: "POST",
    path: "/dashboard/apps/:appId/webhooks",
    handle: async ({ path, body }) => {
      const appId = path.split("/")[3];
      if (appId !== APP_ID) return ok({ success: false, error: "App desconocida" }, 404);
      const form = formOf(body);
      if (typeof form.callback_url !== "string" || typeof form.verify_token !== "string") return ok({ success: false, error: "Faltan callback_url y verify_token" }, 400);
      const verification = await verifyCallback(form.callback_url, form.verify_token);
      if (verification.echoed) appSubscription = subscriptionOf(form);
      return ok({ success: verification.echoed, verification });
    },
  },
  {
    // A file's own URL (§10.2): only with the Bearer token.
    method: "GET",
    path: "/whatsapp_business/attachments",
    handle: ({ headers, query }) => {
      if (refuseUserToken(headers)) return { status: 401, headers: { "content-type": "text/plain; charset=utf-8" }, body: "Unauthorized" };
      const mediaId = /(\d{6,32})$/.exec(String(query.mid ?? ""))?.[1] ?? "";
      const file = media.get(mediaId);
      if (!file) return { status: 404, headers: { "content-type": "text/plain; charset=utf-8" }, body: "Not Found" };
      return { status: 200, headers: { "content-type": file.mimeType, "content-length": String(file.bytes.length) }, body: file.bytes };
    },
  },
  {
    method: "GET",
    path: "/:version/debug_token",
    handle: ({ query }) => {
      const refused = refuseAppToken(query);
      if (refused) return refused;
      const token = String(query.input_token ?? "");
      const base = {
        app_id: APP_ID,
        type: "SYSTEM_USER",
        application: DATA.appName,
        data_access_expires_at: 0,
        expires_at: 0,
        is_valid: true,
        issued_at: 1790380800,
        scopes: ["business_management", "whatsapp_business_management", "whatsapp_business_messaging"],
        granular_scopes: [{ scope: "business_management" }, { scope: "whatsapp_business_management" }, { scope: "whatsapp_business_messaging" }],
        user_id: DATA.systemUserId,
      };
      if (token === DATA.tokens.valid) return ok({ data: base });
      if (token === DATA.tokens.expiring) {
        const now = Math.floor(Date.now() / 1000);
        return ok({ data: { ...base, expires_at: now + 30 * DAY_S, data_access_expires_at: now + 90 * DAY_S } });
      }
      if (token === DATA.tokens.missingMessaging) {
        return ok({
          data: {
            ...base,
            scopes: ["business_management", "whatsapp_business_management"],
            granular_scopes: [{ scope: "business_management" }, { scope: "whatsapp_business_management" }],
          },
        });
      }
      return ok({
        data: {
          app_id: APP_ID,
          type: "SYSTEM_USER",
          application: DATA.appName,
          is_valid: false,
          scopes: [],
          error: { code: 190, message: "Error validating access token: The session has been invalidated.", subcode: 467 },
        },
      });
    },
  },
  {
    method: "GET",
    path: "/:version/:node",
    handle: ({ path, query, headers }) => {
      const segments = graphPath(path);
      const node = segments?.[0] ?? "";
      if (!segments || !NODE.test(node)) return unsupportedGet(node);
      const refused = refuseUserToken(headers);
      if (refused) return refused;
      const fields = query.fields ? String(query.fields).split(",").map((field) => field.trim()) : [];
      if (fields.some((field) => WABA_FIELDS.has(field))) return /^1\d{14}$/.test(node) ? ok(wabaBody(node, query.fields)) : unsupportedGet(node);
      if (fields.some((field) => NUMBER_FIELDS.has(field))) return NUMBER.test(node) ? ok(numberBody(node, query.fields)) : unsupportedGet(node);
      const file = media.get(node);
      return file ? ok(mediaBody(headers, node, file)) : unsupportedGet(node);
    },
  },
  {
    // Fixes or changes the two-step PIN (§5.3).
    method: "POST",
    path: "/:version/:node",
    handle: ({ path, headers, body }) => {
      const node = graphPath(path)?.[0] ?? "";
      if (!NUMBER.test(node)) return unsupportedGet(node);
      const refused = refuseUserToken(headers);
      if (refused) return refused;
      if (!isRecord(body) || typeof body.pin !== "string" || !/^\d{6}$/.test(body.pin)) return invalidParameter("pin");
      return ok({ success: true });
    },
  },
  {
    method: "GET",
    path: "/:version/:node/:edge",
    handle: ({ path, query, headers }) => {
      const [node = "", edge = ""] = graphPath(path) ?? [];
      if (edge === "subscriptions") {
        if (node !== APP_ID) return unsupportedGet(node);
        return refuseAppToken(query) ?? ok({ data: appSubscription ? [appSubscription] : [] });
      }
      const refused = refuseUserToken(headers);
      if (refused) return refused;
      if (edge === "subscribed_apps" && /^1\d{14}$/.test(node)) {
        return ok({
          data: unsubscribedWabas.has(node) ? [] : [{ whatsapp_business_api_data: { id: APP_ID, link: `https://www.facebook.com/games/?app_id=${APP_ID}`, name: DATA.appName } }],
        });
      }
      if (edge === "message_templates" && /^1\d{14}$/.test(node)) return ok(templatesPage(node, query));
      return unsupportedGet(node);
    },
  },
  {
    method: "POST",
    path: "/:version/:node/:edge",
    handle: async ({ path, query, headers, body }) => {
      const [node = "", edge = ""] = graphPath(path) ?? [];
      if (edge === "subscriptions") {
        if (node !== APP_ID) return unsupportedGet(node);
        const refused = refuseAppToken(query);
        if (refused) return refused;
        const form = formOf(body);
        if (form.object !== "whatsapp_business_account") return invalidParameter("object");
        if (typeof form.callback_url !== "string" || typeof form.verify_token !== "string") return invalidParameter("callback_url");
        // Meta checks the address during this request (docs/integracion-whatsapp.md §4.1). The code of a failed check is
        // not in the docs: Graph's usual one is used and the app only shows the message.
        const verification = await verifyCallback(form.callback_url, form.verify_token);
        if (!verification.echoed) {
          return graphError(400, 2200, `(#2200) callback verification failed: HTTP Status Code = ${verification.status}; HTTP Message = verification failed`);
        }
        appSubscription = subscriptionOf(form);
        return ok({ success: true });
      }
      const refused = refuseUserToken(headers);
      if (refused) return refused;
      if (edge === "subscribed_apps" && /^1\d{14}$/.test(node)) {
        // [WA-15]: the app never overrides the callback. Meta would accept it; this mock refuses it so any use shows.
        if (isRecord(body) && ("override_callback_uri" in body || "verify_token" in body)) return invalidParameter("override_callback_uri");
        unsubscribedWabas.delete(node);
        return ok({ success: true });
      }
      if (!NUMBER.test(node)) return unsupportedGet(node);
      switch (edge) {
        case "messages":
          return sendMessage(body);
        case "register":
          if (!isRecord(body) || body.messaging_product !== "whatsapp") return invalidParameter("messaging_product");
          if (typeof body.pin !== "string" || !/^\d{6}$/.test(body.pin)) return invalidParameter("pin");
          registered.add(node);
          return ok({ success: true });
        case "deregister":
          registered.delete(node);
          return ok({ success: true });
        case "request_code":
          if (!isRecord(body) || !["SMS", "VOICE"].includes(String(body.code_method))) return invalidParameter("code_method");
          if (typeof body.language !== "string" || !body.language) return invalidParameter("language");
          return ok({ success: true });
        case "verify_code":
          if (!isRecord(body) || typeof body.code !== "string" || !/^\d{4,10}$/.test(body.code)) return invalidParameter("code");
          return ok({ success: true });
        case "media": {
          sequence += 1;
          const mediaId = `95${String(Date.now()).slice(-8)}${String(sequence).padStart(5, "0")}`;
          const upload = isRecord(body) && typeof body.base64 === "string" ? Buffer.from(body.base64, "base64") : Buffer.alloc(0);
          media.set(mediaId, { bytes: upload, mimeType: "application/octet-stream" });
          return ok({ id: mediaId });
        }
        default:
          return unsupportedGet(node);
      }
    },
  },
  {
    method: "DELETE",
    path: "/:version/:node/:edge",
    handle: ({ path, headers }) => {
      const [node = "", edge = ""] = graphPath(path) ?? [];
      const refused = refuseUserToken(headers);
      if (refused) return refused;
      if (edge !== "subscribed_apps" || !/^1\d{14}$/.test(node)) return unsupportedGet(node);
      unsubscribedWabas.add(node);
      return ok({ success: true });
    },
  },
];

/** For specs that need the number behind a WABA id (account notices come by WABA). */
export { phoneOfWaba, wabaOf };
