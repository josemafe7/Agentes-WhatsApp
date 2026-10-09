// YCloud API default answers (docs/integracion-ycloud.md). YCLOUD_API_BASE_URL points at <mock>/ycloud/v2, so paths keep
// the real «/v2/…» shape, the key travels in X-API-Key and errors are `{ error: { status, code, message } }`, as YCloud's.
//
// Accounts: any key «yc<9 digits><letters>» is an account of its own with ONE WhatsApp number, «+346<8 first digits>»,
// in the WhatsApp Business account «1<the 9 digits>» and named «Negocio de prueba <digits>». A key whose letters start
// with «REVOCADA» is one YCloud no longer accepts (401); one that starts with «SINNUMERO» is an account without
// numbers. Each test uses its own account (e2e/support/ycloud.ts).
//
// What the specs can rely on (per-test errors with POST /__stub):
//   GET    /v2/balance                                   `{ amount: 25, currency: "USD" }`.
//   GET    /v2/whatsapp/phoneNumbers                     a page with the account's number (CONNECTED, GREEN).
//   GET    /v2/whatsapp/phoneNumbers/<waba>/<number>     that number, or 404.
//   GET    /v2/whatsapp/templates                        one APPROVED utility template of the account.
//   POST   /v2/webhookEndpoints                          a new endpoint with its `secret`; GET and DELETE by id.
//   POST   /v2/whatsapp/messages/sendDirectly            a new message id per call, `status: accepted`.
//   POST   /v2/whatsapp/inboundMessages/<id>/markAsRead  and /typing: 200.

const KEY = /^yc(\d{9})([A-Za-z0-9]{1,60})$/;

const error = (status, code) => ({ status, body: { error: { status, code, message: "Simulated error", requestId: "req_e2e" } } });

/** @type {Map<string, { endpoints: Map<string, { id: string, url: string, status: string, enabledEvents: string[] }>, nextEndpoint: number, nextMessage: number }>} */
const accounts = new Map();

function stateOf(accountId) {
  let state = accounts.get(accountId);
  if (!state) {
    state = { endpoints: new Map(), nextEndpoint: 1, nextMessage: 1 };
    accounts.set(accountId, state);
  }
  return state;
}

const numberOf = (accountId) => `+346${accountId.slice(0, 8)}`;

function phoneNumber(accountId) {
  const digits = numberOf(accountId).slice(3);
  return {
    id: `pn_${accountId}`,
    phoneNumber: numberOf(accountId),
    displayPhoneNumber: `+34 ${digits.slice(0, 3)} ${digits.slice(3, 5)} ${digits.slice(5, 7)} ${digits.slice(7, 9)}`,
    wabaId: `1${accountId}`,
    verifiedName: `Negocio de prueba ${accountId}`,
    qualityRating: "GREEN",
    messagingLimit: "TIER_1K",
    status: "CONNECTED",
    codeVerificationStatus: "VERIFIED",
    nameStatus: "APPROVED",
  };
}

const page = (items) => ({ offset: 0, limit: 100, length: items.length, items });

/** The account of the request's key, or the error YCloud gives for it. */
function authorize(request) {
  const match = KEY.exec(String(request.headers["x-api-key"] ?? ""));
  if (!match || match[2].startsWith("REVOCADA")) return { failure: error(401, "UNAUTHORIZED") };
  return { accountId: match[1], state: stateOf(match[1]), withoutNumbers: match[2].startsWith("SINNUMERO") };
}

/** A route of the API: the handler gets the account, its state and the request. */
function route(method, path, handle) {
  return {
    method,
    path,
    handle: (request) => {
      const auth = authorize(request);
      return auth.failure ?? handle({ ...auth, request, body: request.body && typeof request.body === "object" ? request.body : {} });
    },
  };
}

const lastSegment = (path) => decodeURIComponent(path.split("/").filter(Boolean).at(-1) ?? "");

export const ycloudRoutes = [
  route("GET", "/v2/balance", () => ({ status: 200, body: { amount: 25, currency: "USD" } })),
  route("GET", "/v2/whatsapp/phoneNumbers", ({ accountId, withoutNumbers }) => ({ status: 200, body: page(withoutNumbers ? [] : [phoneNumber(accountId)]) })),
  route("GET", "/v2/whatsapp/phoneNumbers/:wabaId/:phoneNumber", ({ accountId, request, withoutNumbers }) =>
    !withoutNumbers && lastSegment(request.path) === numberOf(accountId) ? { status: 200, body: phoneNumber(accountId) } : error(404, "NOT_FOUND"),
  ),
  route("GET", "/v2/whatsapp/templates", ({ accountId }) => ({
    status: 200,
    body: page([
      { officialTemplateId: `9${accountId}`, wabaId: `1${accountId}`, name: "recordatorio_cita", language: "es", category: "UTILITY", status: "APPROVED", components: [{ type: "BODY", text: "Hola {{1}}, te recordamos tu cita del {{2}}." }] },
    ]),
  })),
  route("POST", "/v2/webhookEndpoints", ({ accountId, state, body }) => {
    const id = `we_${accountId}_${state.nextEndpoint++}`;
    const endpoint = { id, url: String(body.url ?? ""), status: "active", enabledEvents: Array.isArray(body.enabledEvents) ? body.enabledEvents : [] };
    state.endpoints.set(id, endpoint);
    return { status: 200, body: { ...endpoint, secret: `whsec_e2e_${accountId}_${id}` } };
  }),
  route("GET", "/v2/webhookEndpoints/:id", ({ state, request }) => {
    const endpoint = state.endpoints.get(lastSegment(request.path));
    return endpoint ? { status: 200, body: endpoint } : error(404, "NOT_FOUND");
  }),
  route("DELETE", "/v2/webhookEndpoints/:id", ({ state, request }) => (state.endpoints.delete(lastSegment(request.path)) ? { status: 200, body: {} } : error(404, "NOT_FOUND"))),
  route("POST", "/v2/whatsapp/messages/sendDirectly", ({ accountId, state, body }) => ({
    status: 200,
    body: { id: `msg_${accountId}_${state.nextMessage++}`, wabaId: `1${accountId}`, from: body.from, to: body.to, type: body.type, status: "accepted", createTime: new Date().toISOString() },
  })),
  route("POST", "/v2/whatsapp/inboundMessages/:id/markAsRead", () => ({ status: 200, body: {} })),
  route("POST", "/v2/whatsapp/inboundMessages/:id/typing", () => ({ status: 200, body: { success: true } })),
];
