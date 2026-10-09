// Telegram Bot API default answers (docs/integracion-telegram.md). TELEGRAM_API_BASE_URL points at <mock>/telegram, so
// paths keep the real «/bot<token>/<method>» shape and every answer is `{ ok, result }` (or `{ ok: false, error_code,
// description }`), as Telegram's.
//
// Bots: any token «<digits>:<letters>» is a bot of its own. Its id is the digits, its user name «prueba_<id>_bot» and its
// name «Bot de prueba <id>»; a token whose second part starts with «REVOCADO» is one @BotFather revoked (401). Each
// test uses its own bot (e2e/support/telegram.ts).
//
// What the specs can rely on (per-test errors with POST /__stub, e.g. a 429 on POST /bot*/sendMessage):
//   POST /bot<token>/getMe            the bot (`is_bot: true`, `first_name`, `username`).
//   POST /bot<token>/getWebhookInfo   `url` («» without webhook) and `pending_update_count`.
//   POST /bot<token>/setWebhook       keeps `url` and `secret_token`; refuses a port Telegram does not take (400).
//   POST /bot<token>/deleteWebhook    forgets them.
//   POST /bot<token>/getUpdates       409 while a webhook is set; else the queued updates from `offset` on (the ones
//                                     below it are confirmed and dropped), without waiting whatever `timeout` says.
//   POST /bot<token>/sendMessage      a new message id per call, in the chat asked for; a text over 4,096 characters → 400.
//   POST /bot<token>/sendChatAction   true.
//   POST /bot<token>/getFile          `file_path` «voice/<file_id>.oga».
//   GET  /file/bot<token>/**          a tiny OGG file.
//   POST /dashboard/bots/<id>/messages  NOT the Bot API: what a customer does in Telegram, writing to the bot. Body
//                                     `{ from: { id, first_name, last_name?, username? }, text }`. With a webhook the update
//                                     is POSTed to it with the bot's secret (answers its status); without one it waits for
//                                     getUpdates. Answers `{ update_id, message_id, delivered }`.

const TOKEN = /^(\d{1,20}):([A-Za-z0-9_-]{1,200})$/;
const ALLOWED_PORTS = new Set(["", "443", "80", "88", "8443"]);
const MAX_TEXT = 4096;
const OGG = Buffer.from([0x4f, 0x67, 0x67, 0x53, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4]);

// ─── State (process lifetime; every test uses a bot of its own) ─────────────────────────────────────────

/** @type {Map<string, { webhook: { url: string, secret: string } | null, updates: Array<Record<string, unknown>>, nextUpdateId: number, nextMessageId: number }>} */
const bots = new Map();

function stateOf(botId) {
  let state = bots.get(botId);
  if (!state) {
    state = { webhook: null, updates: [], nextUpdateId: 5000, nextMessageId: 1 };
    bots.set(botId, state);
  }
  return state;
}

const ok = (result) => ({ status: 200, body: { ok: true, result } });
const error = (code, description) => ({ status: code, body: { ok: false, error_code: code, description } });

const botOf = (botId) => ({ id: Number(botId), is_bot: true, first_name: `Bot de prueba ${botId}`, username: `prueba_${botId}_bot`, can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false });

/** The bot of the path's token, or the error Telegram gives for it. */
function authorize(path) {
  const token = /^\/(?:file\/)?bot([^/]+)\//.exec(path)?.[1] ?? "";
  const match = TOKEN.exec(decodeURIComponent(token));
  if (!match) return { failure: error(404, "Not Found") };
  if (match[2].startsWith("REVOCADO")) return { failure: error(401, "Unauthorized") };
  return { botId: match[1], state: stateOf(match[1]) };
}

/** A route of the Bot API: the handler gets the bot, its state and the JSON body. */
function method(name, handle) {
  return {
    method: "POST",
    path: `/bot*/${name}`,
    handle: (request) => {
      const auth = authorize(request.path);
      if (auth.failure) return auth.failure;
      const body = request.body && typeof request.body === "object" ? request.body : {};
      return handle({ botId: auth.botId, state: auth.state, body });
    },
  };
}

function setWebhook({ state, body }) {
  let url;
  try {
    url = new URL(String(body.url ?? ""));
  } catch {
    return error(400, "Bad Request: invalid webhook URL specified");
  }
  if (url.protocol !== "https:") return error(400, "Bad Request: bad webhook: An HTTPS URL must be provided for webhook");
  if (!ALLOWED_PORTS.has(url.port)) return error(400, "Bad Request: bad webhook: Webhook can be set up only on ports 80, 88, 443 or 8443");
  state.webhook = { url: url.toString(), secret: String(body.secret_token ?? "") };
  return ok(true);
}

function getUpdates({ state, body }) {
  if (state.webhook) return error(409, "Conflict: can't use getUpdates method while webhook is active; use deleteWebhook to delete the webhook first");
  const offset = typeof body.offset === "number" ? body.offset : 0;
  state.updates = state.updates.filter((update) => update.update_id >= offset);
  const limit = typeof body.limit === "number" ? body.limit : 100;
  return ok(state.updates.slice(0, limit));
}

function sendMessage({ botId, state, body }) {
  const text = typeof body.text === "string" ? body.text : "";
  if (!text) return error(400, "Bad Request: message text is empty");
  if (text.length > MAX_TEXT) return error(400, "Bad Request: message is too long");
  const chatId = Number(body.chat_id);
  if (!Number.isFinite(chatId)) return error(400, "Bad Request: chat not found");
  return ok({ message_id: state.nextMessageId++, from: botOf(botId), chat: { id: chatId, type: "private" }, date: Math.floor(Date.now() / 1000), text });
}

/** What a customer does: writes to the bot. */
async function customerWrites(request) {
  const botId = /^\/dashboard\/bots\/(\d{1,20})\/messages$/.exec(request.path)?.[1];
  const input = request.body && typeof request.body === "object" ? request.body : {};
  const from = input.from && typeof input.from === "object" ? input.from : null;
  if (!botId || !from || typeof from.id !== "number") return { status: 400, body: { error: "from.id (number) and text are needed" } };
  const state = stateOf(botId);
  const user = { id: from.id, is_bot: false, first_name: from.first_name ?? "Cliente", ...(from.last_name ? { last_name: from.last_name } : {}), ...(from.username ? { username: from.username } : {}) };
  const update = {
    update_id: state.nextUpdateId++,
    message: { message_id: state.nextMessageId++, from: user, chat: { id: user.id, type: "private", first_name: user.first_name }, date: Math.floor(Date.now() / 1000), text: String(input.text ?? "") },
  };
  if (!state.webhook) {
    state.updates.push(update);
    return { status: 200, body: { update_id: update.update_id, message_id: update.message.message_id, delivered: "queued" } };
  }
  const response = await fetch(state.webhook.url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": state.webhook.secret },
    body: JSON.stringify(update),
  });
  return { status: 200, body: { update_id: update.update_id, message_id: update.message.message_id, delivered: response.status } };
}

export const telegramRoutes = [
  method("getMe", ({ botId }) => ok(botOf(botId))),
  method("getWebhookInfo", ({ state }) => ok({ url: state.webhook?.url ?? "", has_custom_certificate: false, pending_update_count: state.webhook ? 0 : state.updates.length })),
  method("setWebhook", setWebhook),
  method("deleteWebhook", ({ state }) => {
    state.webhook = null;
    return ok(true);
  }),
  method("getUpdates", getUpdates),
  method("sendMessage", sendMessage),
  method("sendChatAction", () => ok(true)),
  method("getFile", ({ body }) => ok({ file_id: String(body.file_id ?? ""), file_unique_id: "AgADe2e", file_size: OGG.length, file_path: `voice/${String(body.file_id ?? "archivo").replace(/[^A-Za-z0-9_-]/g, "")}.oga` })),
  {
    method: "GET",
    path: "/file/bot*/**",
    handle: (request) => authorize(request.path).failure ?? { status: 200, body: OGG, headers: { "content-type": "application/octet-stream" } },
  },
  { method: "POST", path: "/dashboard/bots/:botId/messages", handle: customerWrites },
];
