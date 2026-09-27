// Microsoft's side of the Outlook / Microsoft 365 channel for the Playwright runs (docs/integracion-correo.md §2): the
// business's own Entra app signing in on the identity platform v2, and Microsoft Graph for each mailbox.
// MS_LOGIN_BASE_URL points at <mock>/ms-login and MS_GRAPH_BASE_URL at <mock>/ms-graph; paths keep the real shape.
//
// ms-login (docs §2.2):
//   GET  /:tenant/oauth2/v2.0/authorize           checks the request (tenant `common`, `organizations`, `consumers`, a
//                                                  GUID or a domain; a GUID client_id; response_type=code; response_mode
//                                                  query; redirect_uri; scope; PKCE method) and shows «Elegir una cuenta»
//                                                  with the permissions asked, «Correo electrónico», «Aceptar» and
//                                                  «Cancelar». Invalid requests get an AADSTS error page.
//   GET  /:tenant/oauth2/v2.0/authorize/decision   → 302 to redirect_uri with code, state and session_state, or
//                                                  error=access_denied (AADSTS65004).
//   POST /:tenant/oauth2/v2.0/token                authorization_code (single use, ~1 minute [F30], same client and
//                                                  redirect_uri, PKCE verified) and refresh_token (each use gives a new
//                                                  refresh token, [F32]); a refresh token only with offline_access. Errors
//                                                  in the AADSTS shape: invalid_grant 50173 once access is revoked, 54005
//                                                  for a reused code, 501481 for a wrong PKCE verifier, invalid_client
//                                                  7000215 / 7000218 for a wrong or missing Client Secret.
// ms-graph (docs §2.3–§2.5), Bearer token of a grant of that mailbox; Mail.ReadWrite to read and draft, Mail.Send to
// send, User.Read for /me:
//   GET /v1.0/me · GET /v1.0/me/mailFolders/{inbox|sentitems|drafts}/messages/delta (initial round filtered by
//   `receivedDateTime ge|gt`, then @odata.deltaLink / @odata.nextLink on this same origin, paged by
//   Prefer: odata.maxpagesize; `@removed` for what left the folder) · GET /v1.0/me/messages/{id} ($select, with
//   uniqueBody and internetMessageHeaders only when selected; Prefer: outlook.body-content-type="text") ·
//   GET /v1.0/me/messages/{id}/$value (MIME) · POST …/{id}/createReply (201: a draft «RE: …» to the sender in the same
//   conversation; message.internetMessageHeaders only with names starting x-, [F44]) · PATCH /v1.0/me/messages/{id}
//   (drafts) · POST …/{id}/attachments · POST …/{id}/send (202, the draft moves to Sent Items with the same immutable
//   id, [F45]) · DELETE /v1.0/me/messages/{id}. Errors in Graph's JSON (InvalidAuthenticationToken, ErrorAccessDenied,
//   ErrorItemNotFound, InvalidInternetMessageHeader, ErrorInvalidRecipients…).
//
// Scriptable mailboxes (not Graph: what happens in the mailbox; addresses are per test). Other errors (410 of a delta,
// 429…) through POST /__stub.
//   POST /ms-graph/__mailboxes/:address/messages  { raw: base64, folder?: "inbox" | "sentitems", conversationId?,
//        uniqueBody? } → { id, conversationId, internetMessageId }: an email arrives in the inbox (or a person replies
//        from Outlook: folder sentitems, From = the mailbox). The conversation is the one of a message named by
//        In-Reply-To / References, or a new one.
//   POST /ms-graph/__mailboxes/:address/revoke    the person's sessions are revoked: every token stops working (401,
//        then invalid_grant AADSTS50173).
//   GET  /ms-graph/__mailboxes/:address           messages (folder, draft, conversation, headers, text, MIME reads),
//        `sends` (what left through /send: recipients, subject, text, x- headers, conversation, the message replied to),
//        and the tokens issued.
import { createHash, randomUUID } from "node:crypto";
import {
  addressesIn,
  addressIn,
  bearer,
  buildMime,
  decodeMimeWords,
  encodeHeaderText,
  escapeHtml,
  extractText,
  firstHeader,
  formatAddress,
  formOf,
  headerMap,
  htmlPage,
  htmlToText,
  isRecord,
  messageIdsIn,
  notSimulated,
  parseHeaderLines,
  pkceMatches,
  randomToken,
  rawBytes,
  redirectTo,
  rfc2822Date,
  segmentsOf,
  splitMessage,
  withoutQuotes,
} from "./google-microsoft-mail.mjs";

const GRAPH_RESOURCE = "https://graph.microsoft.com/";
const TENANT = /^(?:common|organizations|consumers|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-z0-9-]+(?:\.[a-z0-9-]+)+)$/i;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCOPE_TEXT = {
  "user.read": "Iniciar sesión y leer tu perfil",
  "mail.readwrite": "Leer y escribir en tu correo",
  "mail.send": "Enviar correo como tú",
  offline_access: "Mantener el acceso a los datos a los que le has dado acceso",
  openid: "Iniciar sesión",
  profile: "Ver tu perfil básico",
  email: "Ver tu dirección de correo electrónico",
};
const FOLDERS = ["inbox", "sentitems", "drafts"];
const FOLDER_IDS = { inbox: "AQMkADAwATM0MDAAMS1pbmJveAAuAAAD", sentitems: "AQMkADAwATM0MDAAMS1zZW50aXRlbXMALgAAAw", drafts: "AQMkADAwATM0MDAAMS1kcmFmdHMALgAAAw" };
const REQUEST_TTL_MS = 10 * 60_000;
/** The code lasts about a minute ([F30]); the app redeems it in the callback. */
const CODE_TTL_MS = 60_000;
const ACCESS_TOKEN_S = 3599;
const DEFAULT_PAGE = 10;

// ─── State (process lifetime) ────────────────────────────────────────────────────────────────────────────

const mailboxes = new Map();
const authRequests = new Map();
const codes = new Map();
const refreshGrants = new Map();
const accessTokens = new Map();

function mailboxFor(address) {
  const key = String(address).trim().toLowerCase();
  let box = mailboxes.get(key);
  if (!box) {
    const hash = createHash("sha256").update(key).digest("hex");
    box = {
      address: key,
      userId: `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`,
      displayName: key.split("@")[0],
      messages: new Map(),
      /** { seq, folder, id }: what entered each folder, for the delta queries. */
      log: [],
      seq: 0,
      sends: [],
      grants: [],
    };
    mailboxes.set(key, box);
  }
  return box;
}

const newMessageId = () => `AAMkAG${randomToken(33)}AAA=`;
const newConversationId = () => `AAQkAG${randomToken(24)}=`;

function logEntry(box, folder, id) {
  box.seq += 1;
  box.log.push({ seq: box.seq, folder, id });
}

// ─── Answers ─────────────────────────────────────────────────────────────────────────────────────────────

const ok = (body, status = 200) => ({ status, body });

function graphError(status, code, message) {
  return { status, body: { error: { code, message, innerError: { date: new Date().toISOString().slice(0, 19), "request-id": randomUUID(), "client-request-id": randomUUID() } } } };
}
const invalidToken = () => graphError(401, "InvalidAuthenticationToken", "Access token has expired or is not yet valid.");
const accessDenied = () => graphError(403, "ErrorAccessDenied", "Access is denied. Check credentials and try again.");
const itemNotFound = () => graphError(404, "ErrorItemNotFound", "The specified object was not found in the store.");

/** The identity platform's error body ([F30], [F36]). */
function aadError(status, error, code, description) {
  const trace = randomUUID();
  const correlation = randomUUID();
  const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19);
  return {
    status,
    body: {
      error,
      error_description: `AADSTS${code}: ${description} Trace ID: ${trace} Correlation ID: ${correlation} Timestamp: ${timestamp}Z`,
      error_codes: [code],
      timestamp: `${timestamp}Z`,
      trace_id: trace,
      correlation_id: correlation,
      error_uri: `https://login.microsoftonline.com/error?code=${code}`,
    },
  };
}

function errorPage(code, description, status = 400) {
  return htmlPage("Iniciar sesión en la cuenta", `<h1>No se puede iniciar sesión</h1><p>AADSTS${code}: ${escapeHtml(description)}</p>`, status);
}

// ─── Messages ────────────────────────────────────────────────────────────────────────────────────────────

const recipient = (address) => ({ emailAddress: { name: address.name ?? address.address, address: address.address } });

function conversationFor(box, references) {
  for (const message of box.messages.values()) {
    if (message.internetMessageId && references.includes(message.internetMessageId)) return message.conversationId;
  }
  return null;
}

function deliver(box, body) {
  if (!isRecord(body) || typeof body.raw !== "string" || !body.raw) return { status: 400, body: { error: "raw (the email in base64) is required" } };
  const folder = body.folder === "sentitems" ? "sentitems" : "inbox";
  const raw = rawBytes(body.raw);
  const headers = headerMap(raw);
  const references = [...messageIdsIn(firstHeader(headers, "in-reply-to")), ...messageIdsIn((headers.references ?? []).join(" "))];
  const text = extractText(raw);
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const message = {
    id: newMessageId(),
    conversationId: typeof body.conversationId === "string" && body.conversationId ? body.conversationId : (conversationFor(box, references) ?? newConversationId()),
    folder,
    isDraft: false,
    createdDateTime: now,
    receivedDateTime: now,
    sentDateTime: now,
    lastModifiedDateTime: now,
    internetMessageId: messageIdsIn(firstHeader(headers, "message-id"))[0] ?? `<${randomToken(12)}@mock.test>`,
    subject: decodeMimeWords(firstHeader(headers, "subject") ?? ""),
    from: addressIn(firstHeader(headers, "from")),
    to: addressesIn(headers.to),
    cc: addressesIn(headers.cc),
    replyTo: addressesIn(headers["reply-to"]),
    body: { contentType: "text", content: text },
    uniqueBody: typeof body.uniqueBody === "string" ? body.uniqueBody : withoutQuotes(text),
    headers: parseHeaderLines(splitMessage(raw).headerText).map(([name, value]) => ({ name, value })),
    inReplyTo: messageIdsIn(firstHeader(headers, "in-reply-to"))[0] ?? null,
    references: messageIdsIn((headers.references ?? []).join(" ")),
    raw,
    replyOf: null,
    attachments: [],
    mimeReads: 0,
  };
  box.messages.set(message.id, message);
  logEntry(box, folder, message.id);
  return ok({ id: message.id, conversationId: message.conversationId, internetMessageId: message.internetMessageId });
}

function textOf(message) {
  return message.body.contentType.toLowerCase() === "html" ? htmlToText(message.body.content) : String(message.body.content ?? "");
}

/** The whole message as Exchange would give it: the original bytes, or built from what Graph holds. */
function mimeOf(message) {
  if (message.raw) return message.raw;
  const headers = [
    ["From", formatAddress(message.from)],
    ["To", message.to.map(formatAddress).join(", ")],
    ["Cc", message.cc.map(formatAddress).join(", ")],
    ["Subject", encodeHeaderText(message.subject)],
    ["Date", rfc2822Date(new Date(message.sentDateTime ?? message.createdDateTime))],
    ["Message-ID", message.internetMessageId],
    ["In-Reply-To", message.inReplyTo],
    ["References", message.references.join(" ")],
    ...message.headers.map(({ name, value }) => [name, value]),
  ];
  return buildMime(headers, textOf(message));
}

function resource(message, select, preferText) {
  const content = (text) => (preferText ? { contentType: "text", content: text } : { contentType: "html", content: `<html><body><div>${escapeHtml(text).replace(/\n/g, "<br>")}</div></body></html>` });
  const text = textOf(message);
  const full = {
    "@odata.etag": `W/"${createHash("sha1").update(`${message.id}:${message.lastModifiedDateTime}`).digest("base64")}"`,
    id: message.id,
    createdDateTime: message.createdDateTime,
    lastModifiedDateTime: message.lastModifiedDateTime,
    receivedDateTime: message.receivedDateTime,
    sentDateTime: message.sentDateTime,
    hasAttachments: message.attachments.length > 0,
    internetMessageId: message.internetMessageId,
    subject: message.subject,
    bodyPreview: text.replace(/\s+/g, " ").trim().slice(0, 255),
    importance: "normal",
    parentFolderId: FOLDER_IDS[message.folder],
    conversationId: message.conversationId,
    isRead: message.folder !== "inbox",
    isDraft: message.isDraft,
    inferenceClassification: "focused",
    body: message.body.contentType.toLowerCase() === "html" && !preferText ? message.body : content(text),
    sender: message.from ? recipient(message.from) : null,
    from: message.from ? recipient(message.from) : null,
    toRecipients: message.to.map(recipient),
    ccRecipients: message.cc.map(recipient),
    bccRecipients: [],
    replyTo: message.replyTo.map(recipient),
  };
  // Only when asked for ([F44]).
  const extra = { uniqueBody: content(message.uniqueBody ?? text), internetMessageHeaders: message.headers };
  if (!select) return full;
  const picked = { "@odata.etag": full["@odata.etag"], id: message.id };
  for (const field of select) {
    if (field in full) picked[field] = full[field];
    else if (field in extra) picked[field] = extra[field];
  }
  return picked;
}

function selectOf(query) {
  return query.$select ? String(query.$select).split(",").map((field) => field.trim()).filter(Boolean) : null;
}

function preferences(headers) {
  const prefer = String(headers.prefer ?? "");
  const size = /odata\.maxpagesize\s*=\s*(\d+)/i.exec(prefer);
  return { text: /outlook\.body-content-type\s*=\s*"?text"?/i.test(prefer), pageSize: size ? Math.min(Math.max(Number(size[1]), 1), 1000) : DEFAULT_PAGE };
}

// ─── Delta ([F38]–[F40]) ─────────────────────────────────────────────────────────────────────────────────

const encodeState = (state) => Buffer.from(JSON.stringify(state)).toString("base64url");
function decodeState(value) {
  try {
    const state = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    return isRecord(state) && typeof state.from === "number" ? state : null;
  } catch {
    return null;
  }
}

function sinceOf(filter) {
  if (!filter) return { since: null };
  const match = /^\s*receivedDateTime\s+(ge|gt)\s+(\S+)\s*$/i.exec(String(filter));
  const date = match ? Date.parse(match[2]) : NaN;
  if (!match || Number.isNaN(date)) return { error: graphError(400, "BadRequest", "Invalid filter clause") };
  return { since: date, strict: match[1].toLowerCase() === "gt" };
}

function delta(box, folder, query, headers) {
  if (!FOLDERS.includes(folder)) return graphError(400, "ErrorInvalidIdMalformed", "Id is malformed.");
  let state;
  if (query.$deltatoken || query.$skiptoken) {
    const token = decodeState(query.$deltatoken ?? query.$skiptoken);
    if (!token || token.folder !== folder || token.mailbox !== box.address) return graphError(410, "syncStateNotFound", "The sync state is not found.");
    state = query.$deltatoken ? { ...token, from: token.upto, upto: box.seq, offset: 0 } : token;
  } else {
    const filter = sinceOf(query.$filter);
    if (filter.error) return filter.error;
    state = { mailbox: box.address, folder, from: 0, upto: box.seq, offset: 0, since: filter.since, strict: filter.strict ?? false, select: selectOf(query) };
  }
  const { text, pageSize } = preferences(headers);
  const seen = new Map();
  for (const entry of box.log) {
    if (entry.folder !== folder || entry.seq <= state.from || entry.seq > state.upto) continue;
    seen.delete(entry.id);
    seen.set(entry.id, entry);
  }
  const items = [];
  for (const id of seen.keys()) {
    const message = box.messages.get(id);
    if (!message || message.folder !== folder) {
      items.push({ "@odata.type": "#microsoft.graph.message", id, "@removed": { reason: "deleted" } });
      continue;
    }
    const received = Date.parse(message.receivedDateTime);
    if (state.since !== null && (state.strict ? received <= state.since : received < state.since)) continue;
    items.push({ "@odata.type": "#microsoft.graph.message", ...resource(message, state.select, text) });
  }
  const page = items.slice(state.offset, state.offset + pageSize);
  const origin = `http://${headers.host}/ms-graph/v1.0/me/mailFolders/${folder}/messages/delta`;
  const more = state.offset + pageSize < items.length;
  const link = more ? `${origin}?$skiptoken=${encodeState({ ...state, offset: state.offset + pageSize })}` : `${origin}?$deltatoken=${encodeState({ ...state, offset: 0 })}`;
  return ok({ "@odata.context": `http://${headers.host}/ms-graph/v1.0/$metadata#Collection(message)`, value: page, [more ? "@odata.nextLink" : "@odata.deltaLink"]: link });
}

// ─── Replies and sending ([F41]–[F46]) ──────────────────────────────────────────────────────────────────

function createReply(box, id, body, headers) {
  const original = box.messages.get(id);
  if (!original || original.isDraft) return itemNotFound();
  const message = isRecord(body) && isRecord(body.message) ? body.message : {};
  if (isRecord(body) && typeof body.comment === "string" && isRecord(message.body)) return graphError(400, "ErrorInvalidRequest", "The comment and the message body can't both be set.");
  const custom = Array.isArray(message.internetMessageHeaders) ? message.internetMessageHeaders : [];
  for (const header of custom) {
    const name = isRecord(header) ? String(header.name ?? "") : "";
    if (!/^x-/i.test(name)) return graphError(400, "InvalidInternetMessageHeader", `The internet message header name '${name}' should start with 'x-' or 'X-'.`);
  }
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const quoted = `\n\n________________________________\nDe: ${original.from?.name ?? ""} <${original.from?.address ?? ""}>\nEnviado: ${original.receivedDateTime}\nAsunto: ${original.subject}\n\n${textOf(original)}`;
  const draft = {
    id: newMessageId(),
    conversationId: original.conversationId,
    folder: "drafts",
    isDraft: true,
    createdDateTime: now,
    receivedDateTime: now,
    sentDateTime: null,
    lastModifiedDateTime: now,
    internetMessageId: `<${randomToken(18).replace(/[-_]/g, "A")}@mock.prod.outlook.com>`,
    subject: `RE: ${original.subject}`,
    from: { name: box.displayName, address: box.address },
    to: original.replyTo.length > 0 ? original.replyTo : original.from ? [original.from] : [],
    cc: [],
    replyTo: [],
    body: { contentType: "text", content: `${typeof body?.comment === "string" ? body.comment : ""}${quoted}` },
    uniqueBody: null,
    headers: custom.map((header) => ({ name: String(header.name), value: String(header.value ?? "") })),
    inReplyTo: original.internetMessageId,
    references: [...original.references, original.internetMessageId].filter(Boolean),
    raw: null,
    replyOf: original.id,
    attachments: [],
    mimeReads: 0,
  };
  box.messages.set(draft.id, draft);
  logEntry(box, "drafts", draft.id);
  return ok(resource(draft, null, preferences(headers).text), 201);
}

function updateMessage(box, id, body, headers) {
  const message = box.messages.get(id);
  if (!message) return itemNotFound();
  if (!isRecord(body)) return graphError(400, "BadRequest", "Empty Payload. JSON content expected.");
  if ("internetMessageHeaders" in body) return graphError(400, "InvalidInternetMessageHeader", "Internet message headers can only be set when the message is created. (simulado)");
  if (("body" in body || "subject" in body || "toRecipients" in body) && !message.isDraft) return graphError(400, "ErrorInvalidRequest", "Only a draft can change its body, subject or recipients. (simulado)");
  if (isRecord(body.body)) message.body = { contentType: String(body.body.contentType ?? "text").toLowerCase() === "html" ? "html" : "text", content: String(body.body.content ?? "") };
  if (typeof body.subject === "string") message.subject = body.subject;
  if (Array.isArray(body.toRecipients)) message.to = body.toRecipients.map((item) => ({ name: item?.emailAddress?.name ?? null, address: String(item?.emailAddress?.address ?? "").toLowerCase() }));
  message.lastModifiedDateTime = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  return ok(resource(message, null, preferences(headers).text));
}

function addAttachment(box, id, body) {
  const message = box.messages.get(id);
  if (!message) return itemNotFound();
  if (!message.isDraft) return graphError(400, "ErrorInvalidRequest", "Attachments can only be added to a draft. (simulado)");
  if (!isRecord(body) || body["@odata.type"] !== "#microsoft.graph.fileAttachment" || typeof body.name !== "string" || typeof body.contentBytes !== "string") {
    return graphError(400, "ErrorInvalidRequest", "A file attachment needs @odata.type, name and contentBytes. (simulado)");
  }
  const attachment = { id: `AAMkAtt${randomToken(16)}=`, name: body.name, contentType: String(body.contentType ?? "application/octet-stream"), size: Buffer.from(body.contentBytes, "base64").length };
  message.attachments.push(attachment);
  return ok({ "@odata.type": "#microsoft.graph.fileAttachment", ...attachment, isInline: false }, 201);
}

function sendDraft(box, id) {
  const message = box.messages.get(id);
  if (!message) return itemNotFound();
  if (!message.isDraft) return graphError(400, "ErrorInvalidRequest", "Only a draft can be sent. (simulado)");
  if (message.to.length === 0) return graphError(400, "ErrorInvalidRecipients", "At least one recipient isn't valid., A message can't be sent because it contains no recipients.");
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  // Sent Items keeps the same immutable id ([F45]).
  message.isDraft = false;
  message.folder = "sentitems";
  message.sentDateTime = now;
  message.receivedDateTime = now;
  message.lastModifiedDateTime = now;
  logEntry(box, "sentitems", message.id);
  box.sends.push({
    id: message.id,
    conversationId: message.conversationId,
    replyOf: message.replyOf,
    to: message.to,
    subject: message.subject,
    text: textOf(message),
    headers: message.headers,
    inReplyTo: message.inReplyTo,
    references: message.references,
    attachments: message.attachments.map(({ name, contentType, size }) => ({ name, contentType, size })),
    at: now,
  });
  return { status: 202, body: null };
}

function deleteMessage(box, id) {
  const message = box.messages.get(id);
  if (!message) return itemNotFound();
  box.messages.delete(id);
  logEntry(box, message.folder, id);
  return { status: 204, body: null };
}

// ─── Graph ───────────────────────────────────────────────────────────────────────────────────────────────

function authorizeGraph(headers) {
  const token = bearer(headers);
  const entry = token ? accessTokens.get(token) : null;
  if (!entry || entry.grant.revoked || entry.expiresAt < Date.now()) return { refused: invalidToken() };
  return { grant: entry.grant, box: mailboxFor(entry.grant.address) };
}

function hasScope(grant, scope) {
  return grant.scopes.some((granted) => granted.replace(GRAPH_RESOURCE, "").toLowerCase() === scope.toLowerCase());
}

function me(box, query) {
  const full = {
    "@odata.context": "https://graph.microsoft.com/v1.0/$metadata#users/$entity",
    businessPhones: [],
    displayName: box.displayName,
    givenName: null,
    jobTitle: null,
    mail: box.address,
    mobilePhone: null,
    officeLocation: null,
    preferredLanguage: "es-ES",
    surname: null,
    userPrincipalName: box.address,
    id: box.userId,
  };
  const select = selectOf(query);
  if (!select) return ok(full);
  return ok(Object.fromEntries(Object.entries(full).filter(([key]) => key === "@odata.context" || key === "id" || select.includes(key))));
}

function graphApi({ method, path, query, headers, body }) {
  const [version, who, ...rest] = segmentsOf(path);
  if (version !== "v1.0" || who !== "me") return notSimulated("ms-graph", method, path);
  const auth = authorizeGraph(headers);
  if (auth.refused) return auth.refused;
  const { box, grant } = auth;
  if (rest.length === 0) return method === "GET" ? (hasScope(grant, "User.Read") ? me(box, query) : accessDenied()) : notSimulated("ms-graph", method, path);
  const [resourceName, id, action, extra] = rest;
  if (resourceName === "mailFolders" && action === "messages" && extra === "delta" && rest.length === 4 && method === "GET") {
    return hasScope(grant, "Mail.ReadWrite") || hasScope(grant, "Mail.Read") ? delta(box, id, query, headers) : accessDenied();
  }
  if (resourceName !== "messages" || !id || rest.length > 3) return notSimulated("ms-graph", method, path);
  const route = `${method} ${action ?? ""}`;
  if (route === "POST send") return hasScope(grant, "Mail.Send") ? sendDraft(box, id) : accessDenied();
  if (!hasScope(grant, "Mail.ReadWrite")) return accessDenied();
  const message = box.messages.get(id);
  switch (route) {
    case "GET ": {
      if (!message) return itemNotFound();
      return ok(resource(message, selectOf(query), preferences(headers).text));
    }
    case "GET $value": {
      if (!message) return itemNotFound();
      message.mimeReads += 1;
      return { status: 200, headers: { "content-type": "message/rfc822" }, body: mimeOf(message) };
    }
    case "POST createReply":
      return createReply(box, id, body, headers);
    case "PATCH ":
      return updateMessage(box, id, body, headers);
    case "POST attachments":
      return addAttachment(box, id, body);
    case "DELETE ":
      return deleteMessage(box, id);
    default:
      return notSimulated("ms-graph", method, path);
  }
}

// ─── Scriptable mailboxes ────────────────────────────────────────────────────────────────────────────────

function describeMessage(message) {
  return {
    id: message.id,
    folder: message.folder,
    isDraft: message.isDraft,
    conversationId: message.conversationId,
    internetMessageId: message.internetMessageId,
    subject: message.subject,
    from: message.from,
    to: message.to,
    inReplyTo: message.inReplyTo,
    references: message.references,
    headers: message.headers,
    text: textOf(message),
    replyOf: message.replyOf,
    mimeReads: message.mimeReads,
  };
}

function mailboxControl({ method, path, body }) {
  const [, address, action] = segmentsOf(path);
  if (!address || !address.includes("@")) return { status: 400, body: { error: "use /__mailboxes/<address>/…" } };
  const box = mailboxFor(address);
  if (method === "GET" && !action) {
    return ok({
      address: box.address,
      userId: box.userId,
      messages: [...box.messages.values()].map((message) => describeMessage(message)),
      sends: box.sends,
      grants: box.grants.map((grant) => ({ clientId: grant.clientId, tenant: grant.tenant, scopes: grant.scopes, revoked: grant.revoked, refreshTokens: [...grant.refreshTokens], accessTokens: [...grant.accessTokens] })),
    });
  }
  if (method === "POST" && action === "messages") return deliver(box, body);
  if (method === "POST" && action === "revoke") {
    for (const grant of box.grants) grant.revoked = true;
    return ok({ revoked: box.grants.length });
  }
  return notSimulated("ms-graph", method, path);
}

// ─── Sign-in (identity platform v2) ──────────────────────────────────────────────────────────────────────

function shortScope(scope) {
  return scope.replace(GRAPH_RESOURCE, "").toLowerCase();
}

function consentPage(pending) {
  const scopes = pending.params.scope.split(/\s+/).filter(Boolean);
  const items = scopes.map((scope) => `<li>${escapeHtml(SCOPE_TEXT[shortScope(scope)] ?? scope)} <small>(${escapeHtml(scope.replace(GRAPH_RESOURCE, ""))})</small></li>`).join("\n");
  return htmlPage(
    "Iniciar sesión en la cuenta (simulado)",
    `<h1>Elegir una cuenta</h1>
<form method="get" action="authorize/decision">
<input type="hidden" name="request" value="${escapeHtml(pending.id)}">
<label for="email">Correo electrónico</label>
<input id="email" name="email" type="email" required autocomplete="off" value="${escapeHtml(pending.params.login_hint ?? "")}">
<h2>Permisos solicitados</h2>
<p>La app <strong>${escapeHtml(pending.params.client_id)}</strong> quiere:</p>
<ul>
${items}
</ul>
<button type="submit" name="decision" value="allow">Aceptar</button>
<button type="submit" name="decision" value="deny" formnovalidate>Cancelar</button>
</form>`,
  );
}

function authorizeRequest({ path, query }) {
  const [tenant] = segmentsOf(path);
  if (!tenant || !TENANT.test(tenant)) return errorPage(90002, `Tenant '${tenant ?? ""}' not found.`);
  if (!query.client_id || !GUID.test(query.client_id)) return errorPage(700016, `Application with identifier '${query.client_id ?? ""}' was not found in the directory.`);
  if (!query.redirect_uri) return errorPage(900144, "The request body must contain the following parameter: 'redirect_uri'.");
  try {
    new URL(String(query.redirect_uri));
  } catch {
    return errorPage(50011, "The redirect URI specified in the request does not match the redirect URIs configured for the application.");
  }
  if (query.response_type !== "code") return errorPage(900144, "The request body must contain the following parameter: 'response_type'.");
  if (query.response_mode && query.response_mode !== "query") return notSimulated("ms-login", "GET", `${path}?response_mode=${query.response_mode}`);
  if (!query.scope || !String(query.scope).trim()) return errorPage(900144, "The request body must contain the following parameter: 'scope'.");
  if (query.code_challenge_method && !["S256", "plain"].includes(query.code_challenge_method)) return errorPage(501491, "Invalid code_challenge_method.");
  const pending = { id: randomToken(12), tenant: tenant.toLowerCase(), params: { ...query, scope: String(query.scope) }, createdAt: Date.now() };
  authRequests.set(pending.id, pending);
  return consentPage(pending);
}

function decision({ query }) {
  const pending = authRequests.get(String(query.request ?? ""));
  if (!pending || Date.now() - pending.createdAt > REQUEST_TTL_MS) return errorPage(50058, "La solicitud de inicio de sesión ya no es válida. Vuelve a la app e inténtalo de nuevo.");
  authRequests.delete(pending.id);
  const params = pending.params;
  if (query.decision !== "allow") {
    return redirectTo(params.redirect_uri, { error: "access_denied", error_description: "AADSTS65004: User declined to consent to access the app.", state: params.state });
  }
  const address = String(query.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return errorPage(50034, "Escribe una dirección de correo válida.");
  mailboxFor(address);
  const code = `0.A${randomToken(48)}`;
  codes.set(code, {
    address,
    tenant: pending.tenant,
    clientId: params.client_id,
    redirectUri: params.redirect_uri,
    challenge: params.code_challenge ?? null,
    challengeMethod: params.code_challenge_method ?? "plain",
    scopes: params.scope.split(/\s+/).filter(Boolean),
    createdAt: Date.now(),
    used: false,
  });
  return redirectTo(params.redirect_uri, { code, state: params.state, session_state: randomUUID() });
}

function issueTokens(grant) {
  const accessToken = `EwB${randomToken(60)}`;
  accessTokens.set(accessToken, { grant, expiresAt: Date.now() + ACCESS_TOKEN_S * 1_000 });
  grant.accessTokens.add(accessToken);
  let refreshToken = null;
  if (grant.offline) {
    refreshToken = `M.C5${randomToken(60)}`;
    refreshGrants.set(refreshToken, grant);
    grant.refreshTokens.add(refreshToken);
  }
  // offline_access and the OpenID scopes are not echoed; the Graph ones come as they were asked for.
  const scope = grant.scopes.filter((item) => !["offline_access", "openid", "profile", "email"].includes(item.toLowerCase())).join(" ");
  return ok({ token_type: "Bearer", scope, expires_in: ACCESS_TOKEN_S, ext_expires_in: ACCESS_TOKEN_S, access_token: accessToken, ...(refreshToken ? { refresh_token: refreshToken } : {}) });
}

function exchangeCode(form, tenant) {
  const entry = codes.get(String(form.code ?? ""));
  if (!entry || entry.tenant !== tenant) return aadError(400, "invalid_grant", 9002313, "Invalid request. Request is malformed or invalid.");
  if (entry.used) return aadError(400, "invalid_grant", 54005, "OAuth2 Authorization code was already redeemed, please retry with a new valid code or use an existing refresh token.");
  if (Date.now() - entry.createdAt > CODE_TTL_MS) return aadError(400, "invalid_grant", 70008, "The provided authorization code or refresh token has expired due to inactivity.");
  if (form.client_id !== entry.clientId || form.redirect_uri !== entry.redirectUri) return aadError(400, "invalid_grant", 9002313, "Invalid request. Request is malformed or invalid.");
  if (!pkceMatches(form.code_verifier, entry.challenge, entry.challengeMethod)) return aadError(400, "invalid_grant", 501481, "The Code_Verifier does not match the code_challenge supplied in the authorization request.");
  entry.used = true;
  const grant = {
    address: entry.address,
    tenant,
    clientId: entry.clientId,
    clientSecret: form.client_secret,
    scopes: entry.scopes,
    offline: entry.scopes.some((scope) => scope.toLowerCase() === "offline_access"),
    revoked: false,
    refreshTokens: new Set(),
    accessTokens: new Set(),
  };
  mailboxFor(entry.address).grants.push(grant);
  return issueTokens(grant);
}

function refresh(form) {
  const grant = refreshGrants.get(String(form.refresh_token ?? ""));
  if (!grant) return aadError(400, "invalid_grant", 9002313, "Invalid request. Request is malformed or invalid.");
  if (grant.revoked) return aadError(400, "invalid_grant", 50173, "The provided grant has expired due to it being revoked, a fresh auth token is needed. The user might have changed or reset their password.");
  if (form.client_id !== grant.clientId) return aadError(400, "invalid_grant", 9002313, "Invalid request. Request is malformed or invalid.");
  if (form.client_secret !== grant.clientSecret) return aadError(401, "invalid_client", 7000215, "Invalid client secret provided. Ensure the secret being sent in the request is the client secret value, not the client secret ID.");
  return issueTokens(grant);
}

function token({ path, body }) {
  const [tenant] = segmentsOf(path);
  if (!tenant || !TENANT.test(tenant)) return aadError(400, "invalid_request", 90002, `Tenant '${tenant ?? ""}' not found.`);
  const form = formOf(body);
  if (!form.client_secret) return aadError(401, "invalid_client", 7000218, "The request body must contain the following parameter: 'client_assertion' or 'client_secret'.");
  if (form.grant_type === "authorization_code") return exchangeCode(form, tenant.toLowerCase());
  if (form.grant_type === "refresh_token") return refresh(form);
  return aadError(400, "unsupported_grant_type", 70003, `The app requested an unsupported grant type '${form.grant_type ?? ""}'.`);
}

/** @type {import("../server.mjs").MockRoute[]} */
export const microsoftLoginRoutes = [
  { method: "GET", path: "/:tenant/oauth2/v2.0/authorize", handle: authorizeRequest },
  { method: "GET", path: "/:tenant/oauth2/v2.0/authorize/decision", handle: decision },
  { method: "POST", path: "/:tenant/oauth2/v2.0/token", handle: token },
];

/** @type {import("../server.mjs").MockRoute[]} */
export const microsoftGraphRoutes = [
  { method: "GET", path: "/__mailboxes/**", handle: mailboxControl },
  { method: "POST", path: "/__mailboxes/**", handle: mailboxControl },
  ...["GET", "POST", "PATCH", "DELETE"].map((method) => ({ method, path: "/v1.0/**", handle: graphApi })),
];
