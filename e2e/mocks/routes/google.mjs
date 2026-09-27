// Google's side of the Gmail channel for the Playwright runs (docs/integracion-correo.md §1): the business's own OAuth
// client signing in on Google's consent screen, and the Gmail API of each mailbox. GOOGLE_OAUTH_BASE_URL points at
// <mock>/google-oauth and GOOGLE_API_BASE_URL at <mock>/google, so paths keep the real shape after the prefix.
//
// google-oauth (docs §1.3):
//   GET  /o/oauth2/v2/auth            checks the request like Google (response_type=code, a *.apps.googleusercontent.com
//                                     client, redirect_uri, scope, PKCE method) and shows the consent screen: «Correo
//                                     electrónico» (login_hint prefilled), one ticked checkbox per permission asked
//                                     (granular consent: unticking gmail.modify is possible, [COR-03]), «Continuar» and
//                                     «Cancelar». Invalid requests get Google's error page, never a redirect.
//   GET  /o/oauth2/v2/auth/decision   the form's answer → 302 to redirect_uri with code, state and the granted scope, or
//                                     error=access_denied. include_granted_scopes adds what the account granted before.
//   POST /token                       authorization_code (single use, 10 min, same client and redirect_uri, PKCE S256
//                                     verified) and refresh_token (same client and secret). A refresh token only with
//                                     access_type=offline, and again only with prompt=consent once one was given ([F1]).
//                                     Errors as Google: invalid_grant «Token has been expired or revoked.» and co.
//   POST /revoke                      revokes the grant of a refresh or access token ([F1]); unknown → invalid_token.
// google (Gmail API, docs §1.4–§1.6), Bearer token of a grant of that mailbox with gmail.modify, users/me or the address:
//   GET profile · GET history (records after startHistoryId: messagesAdded and labelsAdded, both always: the mock server
//   keeps only the last value of a repeated query parameter, so historyTypes cannot be read) · GET messages (one labelIds;
//   `q` is ignored: every simulated email is recent) · GET messages/{id}?format=raw|minimal|metadata · POST messages/send
//   · POST messages/{id}/modify · POST drafts · POST drafts/send · DELETE drafts/{id} · GET/POST labels.
//   Threading as Gmail documents it ([F18]): a sent message or draft joins `threadId` only if its In-Reply-To or
//   References name a message of that thread and its subject matches (Re: aside); otherwise it starts a new thread,
//   and the mailbox records `threaded: false` so a test can tell. Errors: 401 UNAUTHENTICATED, 403 insufficient scopes,
//   404 NOT_FOUND, 400 invalid label / missing raw, 409 duplicate label, in Google's JSON.
//
// Scriptable mailboxes (not Google: what happens in the mailbox; each test uses addresses of its own, so nothing needs
// resetting). Per-test errors and variants (a 404 of history for a full sync, a 429…) go through POST /__stub as usual.
//   POST /google/__mailboxes/:address/messages  { raw: base64, labelIds?: ["INBOX","UNREAD",…] | ["SENT"], threadId?,
//        internalDate? } → { id, threadId, labelIds, historyId }: an email arrives (or, with SENT and From = the mailbox,
//        a person replies from Gmail). Without threadId, Gmail's threading of incoming mail: References + subject.
//   POST /google/__mailboxes/:address/revoke    the person removes the app's access in their Google Account: every
//        token of the mailbox stops working (401, then invalid_grant) and the next consent is a first one again.
//   GET  /google/__mailboxes/:address           what is in it: messages (labels, headers, text, times read raw),
//        drafts, `sends` (via messages.send or drafts.send, threadId asked and given, threaded, headers, text),
//        `modified` (label changes with label names), labels and the tokens issued (so a test can check none of them
//        ever reaches a page).
import { createHash } from "node:crypto";
import {
  bearer,
  describeRaw,
  escapeHtml,
  formOf,
  headerMap,
  firstHeader,
  htmlPage,
  isRecord,
  messageIdsIn,
  normalizeSubject,
  notSimulated,
  pkceMatches,
  randomToken,
  rawBytes,
  redirectTo,
  segmentsOf,
} from "./google-microsoft-mail.mjs";

const GMAIL_MODIFY = "https://www.googleapis.com/auth/gmail.modify";
/** How Google names the short scopes in its answers. */
const EXPANDED_SCOPES = { email: "https://www.googleapis.com/auth/userinfo.email", profile: "https://www.googleapis.com/auth/userinfo.profile" };
const SCOPE_TEXT = {
  "https://www.googleapis.com/auth/userinfo.email": "Ver la dirección de correo electrónico principal de tu cuenta de Google",
  "https://www.googleapis.com/auth/userinfo.profile": "Ver tu información personal, incluida la que hayas hecho pública",
  [GMAIL_MODIFY]: "Leer, redactar y enviar correos electrónicos de tu cuenta de Gmail",
};
const SYSTEM_LABELS = [
  "CHAT",
  "SENT",
  "INBOX",
  "IMPORTANT",
  "TRASH",
  "DRAFT",
  "SPAM",
  "CATEGORY_FORUMS",
  "CATEGORY_UPDATES",
  "CATEGORY_PERSONAL",
  "CATEGORY_PROMOTIONS",
  "CATEGORY_SOCIAL",
  "STARRED",
  "UNREAD",
];
const INBOUND_LABELS = ["INBOX", "UNREAD", "CATEGORY_PERSONAL"];
const REQUEST_TTL_MS = 10 * 60_000;
const CODE_TTL_MS = 10 * 60_000;
const ACCESS_TOKEN_S = 3599;
const MAX_PAGE = 500;

// ─── State (process lifetime) ────────────────────────────────────────────────────────────────────────────

/** @type {Map<string, ReturnType<typeof newMailbox>>} by lower-case address */
const mailboxes = new Map();
/** Consent screens shown and not answered yet, by request id. */
const authRequests = new Map();
const codes = new Map();
/** Refresh token → grant. */
const refreshGrants = new Map();
/** Access token → { grant, expiresAt }. */
const accessTokens = new Map();
/** «address|clientId» → { scopes: Set, refreshGiven: boolean }: what the account already granted that client. */
const consents = new Map();
let counter = 0;

function newMailbox(address) {
  const historyId = 3_000_000 + mailboxes.size * 10_000;
  return {
    address,
    firstHistoryId: historyId,
    historyId,
    /** { id, type: "messageAdded" | "labelAdded", messageId, threadId, labelIds } */
    history: [],
    messages: new Map(),
    drafts: new Map(),
    labels: SYSTEM_LABELS.map((name) => ({ id: name, name, type: "system" })),
    nextLabel: 1,
    sends: [],
    modified: [],
    grants: [],
  };
}

function mailboxFor(address) {
  const key = String(address).trim().toLowerCase();
  let box = mailboxes.get(key);
  if (!box) {
    box = newMailbox(key);
    mailboxes.set(key, box);
  }
  return box;
}

const nextId = () => `${(BigInt(Date.now()) * 4096n + BigInt(++counter % 4096)).toString(16)}`;

// ─── Answers ─────────────────────────────────────────────────────────────────────────────────────────────

const ok = (body, status = 200) => ({ status, body });

function gmailError(status, message, reason, statusText) {
  return { status, body: { error: { code: status, message, errors: [{ message, domain: "global", reason }], status: statusText } } };
}
const unauthenticated = () =>
  gmailError(
    401,
    "Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential. See https://developers.google.com/identity/sign-in/web/devconsole-project.",
    "authError",
    "UNAUTHENTICATED",
  );
const insufficientScopes = () => gmailError(403, "Request had insufficient authentication scopes.", "insufficientPermissions", "PERMISSION_DENIED");
const notFound = () => gmailError(404, "Requested entity was not found.", "notFound", "NOT_FOUND");
const invalidArgument = (message) => gmailError(400, message, "invalidArgument", "INVALID_ARGUMENT");

const oauthError = (error, description, status = 400) => ({ status, body: { error, error_description: description } });

function errorPage(code, detail, status = 400) {
  return htmlPage(
    "Error de autorización",
    `<h1>Acceso bloqueado: error de autorización</h1><p>${escapeHtml(detail)}</p><p>Error ${status}: ${escapeHtml(code)}</p>`,
    status,
  );
}

// ─── Messages and threads ────────────────────────────────────────────────────────────────────────────────

function addMessage(box, { raw, labelIds, threadId = null, internalDate = Date.now() }) {
  const id = nextId();
  const info = describeRaw(raw);
  const message = { id, threadId: threadId ?? id, labelIds: new Set(labelIds), raw, internalDate, info, historyId: 0, rawReads: 0 };
  box.messages.set(id, message);
  record(box, "messageAdded", message, [...message.labelIds]);
  return message;
}

function record(box, type, message, labelIds) {
  box.historyId += 1;
  message.historyId = box.historyId;
  box.history.push({ id: box.historyId, type, messageId: message.id, threadId: message.threadId, labelIds });
}

function threadMessages(box, threadId) {
  return [...box.messages.values()].filter((message) => message.threadId === threadId).sort((a, b) => a.internalDate - b.internalDate);
}

/** Gmail's rule for API sends and drafts ([F18]): threadId + In-Reply-To/References of that thread + same subject. */
function apiThread(box, raw, requested) {
  if (!requested) return { threadId: null, threaded: false, problems: ["sin threadId"] };
  const thread = threadMessages(box, requested);
  if (thread.length === 0) return { threadId: null, threaded: false, problems: ["threadId desconocido"] };
  const headers = headerMap(raw);
  const references = [...messageIdsIn(firstHeader(headers, "in-reply-to")), ...messageIdsIn((headers.references ?? []).join(" "))];
  const known = new Set(thread.map((message) => message.info.messageId).filter(Boolean));
  const problems = [];
  if (!references.some((reference) => known.has(reference))) problems.push("In-Reply-To/References no nombran el hilo");
  if (normalizeSubject(firstHeader(headers, "subject")) !== normalizeSubject(thread[0].info.subject)) problems.push("el asunto no coincide");
  return problems.length === 0 ? { threadId: requested, threaded: true, problems } : { threadId: null, threaded: false, problems };
}

/** Gmail's threading of incoming mail: a message of the mailbox named by References / In-Reply-To, same subject. */
function inboundThread(box, raw) {
  const headers = headerMap(raw);
  const references = new Set([...messageIdsIn(firstHeader(headers, "in-reply-to")), ...messageIdsIn((headers.references ?? []).join(" "))]);
  const subject = normalizeSubject(firstHeader(headers, "subject"));
  for (const message of box.messages.values()) {
    if (message.info.messageId && references.has(message.info.messageId) && normalizeSubject(message.info.subject) === subject) return message.threadId;
  }
  return null;
}

function snippetOf(message) {
  return message.info.text.replace(/\s+/g, " ").trim().slice(0, 120);
}

function messageResource(message, format) {
  const base = {
    id: message.id,
    threadId: message.threadId,
    labelIds: [...message.labelIds],
    snippet: snippetOf(message),
    sizeEstimate: message.raw.length,
    historyId: String(message.historyId),
    internalDate: String(message.internalDate),
  };
  if (format === "raw") return { ...base, raw: message.raw.toString("base64url") };
  if (format === "metadata") {
    return { ...base, payload: { mimeType: "text/plain", headers: Object.entries(message.info.headers).flatMap(([name, values]) => values.map((value) => ({ name, value }))) } };
  }
  return base;
}

function hasRecipient(raw) {
  const headers = headerMap(raw);
  return ["to", "cc", "bcc"].some((name) => (headers[name] ?? []).some((value) => value.includes("@")));
}

function pageOf(items, query) {
  const size = Math.min(Math.max(Number(query.maxResults) || 100, 1), MAX_PAGE);
  const offset = query.pageToken ? Number(Buffer.from(String(query.pageToken), "base64url").toString("utf8")) || 0 : 0;
  const page = items.slice(offset, offset + size);
  const next = offset + size < items.length ? Buffer.from(String(offset + size)).toString("base64url") : null;
  return { page, next };
}

// ─── Gmail API ───────────────────────────────────────────────────────────────────────────────────────────

function authorizeApi(headers) {
  const token = bearer(headers);
  const entry = token ? accessTokens.get(token) : null;
  if (!entry || entry.grant.revoked || entry.expiresAt < Date.now()) return { refused: unauthenticated() };
  return { grant: entry.grant, box: mailboxFor(entry.grant.address) };
}

function listHistory(box, query) {
  const start = Number(query.startHistoryId);
  if (!query.startHistoryId || !Number.isSafeInteger(start) || start < 0) return invalidArgument("Invalid startHistoryId");
  // History older than what the mailbox keeps: the app must do a full sync ([F13]).
  if (start < box.firstHistoryId) return notFound();
  const records = box.history.filter((entry) => entry.id > start && (!query.labelId || entry.labelIds.includes(query.labelId)));
  const { page, next } = pageOf(records, query);
  const history = page.map((entry) => {
    const current = box.messages.get(entry.messageId);
    const message = { id: entry.messageId, threadId: entry.threadId, labelIds: current ? [...current.labelIds] : entry.labelIds };
    return {
      id: String(entry.id),
      messages: [{ id: entry.messageId, threadId: entry.threadId }],
      ...(entry.type === "messageAdded" ? { messagesAdded: [{ message }] } : { labelsAdded: [{ message, labelIds: entry.labelIds }] }),
    };
  });
  return ok({ ...(history.length > 0 ? { history } : {}), ...(next ? { nextPageToken: next } : {}), historyId: String(box.historyId) });
}

function listMessages(box, query) {
  const label = query.labelIds ? String(query.labelIds) : null;
  const withSpamTrash = query.includeSpamTrash === "true";
  const found = [...box.messages.values()]
    .filter((message) => (!label || message.labelIds.has(label)) && (withSpamTrash || (!message.labelIds.has("SPAM") && !message.labelIds.has("TRASH"))))
    .sort((a, b) => b.internalDate - a.internalDate);
  const { page, next } = pageOf(found, query);
  return ok({
    ...(page.length > 0 ? { messages: page.map((message) => ({ id: message.id, threadId: message.threadId })) } : {}),
    ...(next ? { nextPageToken: next } : {}),
    resultSizeEstimate: found.length,
  });
}

function getMessage(box, id, query) {
  const message = box.messages.get(id);
  if (!message) return notFound();
  const format = String(query.format ?? "full");
  if (format === "full") return notSimulated("google", "GET", `/gmail/v1/users/me/messages/${id}?format=full`);
  if (!["raw", "minimal", "metadata"].includes(format)) return invalidArgument(`Invalid value at 'format' (${format})`);
  if (format === "raw") message.rawReads += 1;
  return ok(messageResource(message, format));
}

function recordSend(box, sent, via, placement, requested, draftId) {
  box.sends.push({
    id: sent.id,
    threadId: sent.threadId,
    requestedThreadId: requested,
    threaded: placement.threaded,
    threadingProblems: placement.problems,
    via,
    draftId,
    at: new Date().toISOString(),
    ...sent.info,
  });
}

function sendMessage(box, body) {
  if (!isRecord(body) || typeof body.raw !== "string" || !body.raw) return invalidArgument("'raw' RFC822 payload message string or uploading message via /upload/* URL required");
  const raw = rawBytes(body.raw);
  if (!hasRecipient(raw)) return invalidArgument("Recipient address required");
  const requested = typeof body.threadId === "string" && body.threadId ? body.threadId : null;
  const placement = apiThread(box, raw, requested);
  const sent = addMessage(box, { raw, labelIds: ["SENT"], threadId: placement.threadId });
  recordSend(box, sent, "messages.send", placement, requested, null);
  return ok({ id: sent.id, threadId: sent.threadId, labelIds: [...sent.labelIds] });
}

function createDraft(box, body) {
  const message = isRecord(body) && isRecord(body.message) ? body.message : null;
  if (!message || typeof message.raw !== "string" || !message.raw) return invalidArgument("Message payload cannot be empty");
  const raw = rawBytes(message.raw);
  const requested = typeof message.threadId === "string" && message.threadId ? message.threadId : null;
  const placement = apiThread(box, raw, requested);
  const draftMessage = addMessage(box, { raw, labelIds: ["DRAFT"], threadId: placement.threadId });
  const id = `r${Date.now()}${String(++counter).padStart(6, "0")}`;
  box.drafts.set(id, { id, messageId: draftMessage.id, requestedThreadId: requested, threaded: placement.threaded, threadingProblems: placement.problems, createdAt: new Date().toISOString() });
  return ok({ id, message: { id: draftMessage.id, threadId: draftMessage.threadId, labelIds: ["DRAFT"] } });
}

function sendDraft(box, body) {
  if (!isRecord(body) || typeof body.id !== "string" || !body.id) return invalidArgument("Invalid draft id");
  const draft = box.drafts.get(body.id);
  const current = draft ? box.messages.get(draft.messageId) : null;
  if (!draft || !current) return notFound();
  const update = isRecord(body.message) && typeof body.message.raw === "string" && body.message.raw ? body.message : null;
  const raw = update ? rawBytes(update.raw) : current.raw;
  if (!hasRecipient(raw)) return invalidArgument("Recipient address required");
  const requested = update ? (typeof update.threadId === "string" && update.threadId ? update.threadId : null) : draft.requestedThreadId;
  const placement = update ? apiThread(box, raw, requested) : { threadId: current.threadId, threaded: draft.threaded, problems: draft.threadingProblems };
  box.drafts.delete(draft.id);
  box.messages.delete(current.id);
  const sent = addMessage(box, { raw, labelIds: ["SENT"], threadId: placement.threadId });
  recordSend(box, sent, "drafts.send", placement, requested, draft.id);
  return ok({ id: sent.id, threadId: sent.threadId, labelIds: [...sent.labelIds] });
}

function deleteDraft(box, id) {
  const draft = box.drafts.get(id);
  if (!draft) return notFound();
  box.drafts.delete(id);
  box.messages.delete(draft.messageId);
  return { status: 204, body: null };
}

function createLabel(box, body) {
  const name = isRecord(body) && typeof body.name === "string" ? body.name.trim() : "";
  if (!name || SYSTEM_LABELS.includes(name.toUpperCase())) return invalidArgument("Invalid label name");
  if (box.labels.some((label) => label.name.toLowerCase() === name.toLowerCase())) return gmailError(409, "Label name exists or conflicts", "duplicate", "ALREADY_EXISTS");
  const label = {
    id: `Label_${box.nextLabel++}`,
    name,
    type: "user",
    messageListVisibility: typeof body.messageListVisibility === "string" ? body.messageListVisibility : "show",
    labelListVisibility: typeof body.labelListVisibility === "string" ? body.labelListVisibility : "labelShow",
  };
  box.labels.push(label);
  return ok(label);
}

function modifyMessage(box, id, body) {
  const message = box.messages.get(id);
  if (!message) return notFound();
  const add = isRecord(body) && Array.isArray(body.addLabelIds) ? body.addLabelIds.map(String) : [];
  const remove = isRecord(body) && Array.isArray(body.removeLabelIds) ? body.removeLabelIds.map(String) : [];
  const unknown = [...add, ...remove].find((labelId) => !box.labels.some((label) => label.id === labelId));
  if (unknown) return invalidArgument(`Invalid label: ${unknown}`);
  const added = add.filter((labelId) => !message.labelIds.has(labelId));
  for (const labelId of add) message.labelIds.add(labelId);
  for (const labelId of remove) message.labelIds.delete(labelId);
  if (added.length > 0) record(box, "labelAdded", message, added);
  box.modified.push({ id, addLabelIds: add, removeLabelIds: remove, at: new Date().toISOString() });
  return ok({ id: message.id, threadId: message.threadId, labelIds: [...message.labelIds] });
}

function gmailApi({ method, path, query, headers, body }) {
  const [api, version, users, user, ...rest] = segmentsOf(path);
  if (api !== "gmail" || version !== "v1" || users !== "users" || !user) return notSimulated("google", method, path);
  const auth = authorizeApi(headers);
  if (auth.refused) return auth.refused;
  const { box, grant } = auth;
  if (user !== "me" && user.toLowerCase() !== box.address) return gmailError(403, `Delegation denied for ${box.address}`, "forbidden", "PERMISSION_DENIED");
  if (!grant.scopes.includes(GMAIL_MODIFY)) return insufficientScopes();
  const [resource, id, action] = rest;
  const route = `${method} ${resource ?? ""}${id ? "/:id" : ""}${action ? `/${action}` : ""}`;
  switch (route) {
    case "GET profile":
      return ok({ emailAddress: box.address, messagesTotal: box.messages.size, threadsTotal: new Set([...box.messages.values()].map((message) => message.threadId)).size, historyId: String(box.historyId) });
    case "GET history":
      return listHistory(box, query);
    case "GET messages":
      return listMessages(box, query);
    case "GET messages/:id":
      return getMessage(box, id, query);
    case "POST messages/:id":
      return id === "send" ? sendMessage(box, body) : notSimulated("google", method, path);
    case "POST messages/:id/modify":
      return modifyMessage(box, id, body);
    case "POST drafts":
      return createDraft(box, body);
    case "POST drafts/:id":
      return id === "send" ? sendDraft(box, body) : notSimulated("google", method, path);
    case "DELETE drafts/:id":
      return deleteDraft(box, id);
    case "GET labels":
      return ok({ labels: box.labels });
    case "POST labels":
      return createLabel(box, body);
    default:
      return notSimulated("google", method, path);
  }
}

// ─── Scriptable mailboxes ────────────────────────────────────────────────────────────────────────────────

function labelNames(box, ids) {
  return ids.map((id) => box.labels.find((label) => label.id === id)?.name ?? id);
}

function describeMessage(box, message) {
  return { id: message.id, threadId: message.threadId, labelIds: [...message.labelIds], labelNames: labelNames(box, [...message.labelIds]), internalDate: message.internalDate, rawReads: message.rawReads, ...message.info };
}

function snapshot(box) {
  return {
    address: box.address,
    historyId: String(box.historyId),
    labels: box.labels,
    messages: [...box.messages.values()].map((message) => describeMessage(box, message)),
    drafts: [...box.drafts.values()].map((draft) => {
      const message = box.messages.get(draft.messageId);
      const { messageId: gmailMessageId, ...meta } = draft;
      // `id` is the draft's; `messageId` stays the RFC Message-ID of its message, like everywhere else.
      return { ...meta, ...(message ? describeMessage(box, message) : {}), id: draft.id, gmailMessageId };
    }),
    sends: box.sends,
    modified: box.modified.map((change) => ({ ...change, addLabelNames: labelNames(box, change.addLabelIds) })),
    grants: box.grants.map((grant) => ({ clientId: grant.clientId, scopes: grant.scopes, revoked: grant.revoked, refreshToken: grant.refreshToken, accessTokens: [...grant.accessTokens] })),
  };
}

function deliver(box, body) {
  if (!isRecord(body) || typeof body.raw !== "string" || !body.raw) return { status: 400, body: { error: "raw (the email in base64) is required" } };
  const raw = rawBytes(body.raw);
  const labelIds = Array.isArray(body.labelIds) && body.labelIds.length > 0 ? body.labelIds.map(String) : INBOUND_LABELS;
  const unknown = labelIds.find((labelId) => !box.labels.some((label) => label.id === labelId));
  if (unknown) return { status: 400, body: { error: `unknown label ${unknown}` } };
  const threadId = typeof body.threadId === "string" && body.threadId ? body.threadId : inboundThread(box, raw);
  const internalDate = Number.isFinite(Number(body.internalDate)) && Number(body.internalDate) > 0 ? Number(body.internalDate) : Date.now();
  const message = addMessage(box, { raw, labelIds, threadId, internalDate });
  return ok({ id: message.id, threadId: message.threadId, labelIds: [...message.labelIds], historyId: String(box.historyId) });
}

function revokeGrant(grant) {
  grant.revoked = true;
  consents.delete(`${grant.address}|${grant.clientId}`);
}

function mailboxControl({ method, path, body }) {
  const [, address, action] = segmentsOf(path);
  if (!address || !address.includes("@")) return { status: 400, body: { error: "use /__mailboxes/<address>/…" } };
  const box = mailboxFor(address);
  if (method === "GET" && !action) return ok(snapshot(box));
  if (method === "POST" && action === "messages") return deliver(box, body);
  if (method === "POST" && action === "revoke") {
    for (const grant of box.grants) revokeGrant(grant);
    return ok({ revoked: box.grants.length });
  }
  return notSimulated("google", method, path);
}

// ─── OAuth 2.0 ───────────────────────────────────────────────────────────────────────────────────────────

const CLIENT_ID = /^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/;

function expandScope(scope) {
  return EXPANDED_SCOPES[scope] ?? scope;
}

function consentPage(pending) {
  const params = pending.params;
  const scopes = params.scope.split(/\s+/).filter(Boolean);
  const checkboxes = scopes
    .filter((scope) => scope !== "openid")
    .map((scope) => {
      const expanded = expandScope(scope);
      return `<label><input type="checkbox" name="grant:${escapeHtml(scope)}" value="yes" checked> ${escapeHtml(SCOPE_TEXT[expanded] ?? expanded)}</label>`;
    })
    .join("\n");
  return htmlPage(
    "Iniciar sesión con Google (simulado)",
    `<h1>Elige una cuenta</h1>
<p>para continuar a la app del cliente OAuth <strong>${escapeHtml(params.client_id)}</strong></p>
<form method="get" action="auth/decision">
<input type="hidden" name="request" value="${escapeHtml(pending.id)}">
<label for="email">Correo electrónico</label>
<input id="email" name="email" type="email" required autocomplete="off" value="${escapeHtml(params.login_hint ?? "")}">
<fieldset>
<legend>La app quiere acceder a tu cuenta de Google</legend>
${scopes.includes("openid") ? "<p>Asociarte con tu información personal en Google</p>" : ""}
${checkboxes}
</fieldset>
<button type="submit" name="decision" value="allow">Continuar</button>
<button type="submit" name="decision" value="deny" formnovalidate>Cancelar</button>
</form>`,
  );
}

function authorizeRequest({ query }) {
  if (query.response_type !== "code") return errorPage("unsupported_response_type", `Unsupported response type: ${query.response_type ?? "(none)"}`);
  if (!query.client_id || !CLIENT_ID.test(query.client_id)) return errorPage("invalid_client", "The OAuth client was not found.", 401);
  let redirect;
  try {
    redirect = new URL(String(query.redirect_uri ?? ""));
  } catch {
    return errorPage("invalid_request", "Missing required parameter: redirect_uri");
  }
  if (!["http:", "https:"].includes(redirect.protocol)) return errorPage("invalid_request", "Invalid parameter value for redirect_uri");
  if (!query.scope || !String(query.scope).trim()) return errorPage("invalid_request", "Missing required parameter: scope");
  if (query.code_challenge_method && !["S256", "plain"].includes(query.code_challenge_method)) return errorPage("invalid_request", "Invalid code_challenge_method");
  if (query.code_challenge && !/^[A-Za-z0-9._~-]{43,128}$/.test(query.code_challenge)) return errorPage("invalid_request", "Invalid code_challenge");
  const pending = { id: randomToken(12), params: { ...query, scope: String(query.scope) }, createdAt: Date.now() };
  authRequests.set(pending.id, pending);
  return consentPage(pending);
}

function decision({ query }) {
  const pending = authRequests.get(String(query.request ?? ""));
  if (!pending || Date.now() - pending.createdAt > REQUEST_TTL_MS) return errorPage("invalid_request", "Esta solicitud de inicio de sesión ya no es válida. Vuelve a la app e inténtalo de nuevo.");
  authRequests.delete(pending.id);
  const params = pending.params;
  if (query.decision !== "allow") return redirectTo(params.redirect_uri, { error: "access_denied", state: params.state });
  const address = String(query.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return errorPage("invalid_request", "Escribe una dirección de correo válida.");
  mailboxFor(address);
  const requested = params.scope.split(/\s+/).filter(Boolean);
  const granted = requested.filter((scope) => scope === "openid" || query[`grant:${scope}`] === "yes").map(expandScope);
  const key = `${address}|${params.client_id}`;
  const previous = consents.get(key);
  const scopes = new Set(params.include_granted_scopes === "true" && previous ? [...previous.scopes, ...granted] : granted);
  consents.set(key, { scopes, refreshGiven: previous?.refreshGiven ?? false });
  const code = `4/0${randomToken(36)}`;
  codes.set(code, {
    address,
    clientId: params.client_id,
    redirectUri: params.redirect_uri,
    challenge: params.code_challenge ?? null,
    challengeMethod: params.code_challenge_method ?? "plain",
    scopes: [...scopes],
    offline: params.access_type === "offline",
    forceConsent: String(params.prompt ?? "").split(/\s+/).includes("consent"),
    createdAt: Date.now(),
    used: false,
  });
  return redirectTo(params.redirect_uri, { state: params.state, code, scope: [...scopes].join(" "), authuser: "0", prompt: params.prompt ?? "none" });
}

function idToken(grant) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  // Google's stable account id: digits only (docs §1.3, [F4]).
  const sub = `1${BigInt(`0x${createHash("sha256").update(grant.address).digest("hex").slice(0, 15)}`).toString().padStart(20, "0")}`;
  return `${part({ alg: "RS256", kid: "e2e", typ: "JWT" })}.${part({ iss: "https://accounts.google.com", azp: grant.clientId, aud: grant.clientId, sub, email: grant.address, email_verified: true, iat: now, exp: now + 3600 })}.e2e-unsigned`;
}

function issueAccess(grant) {
  const token = `ya29.a0${randomToken(48)}`;
  accessTokens.set(token, { grant, expiresAt: Date.now() + ACCESS_TOKEN_S * 1_000 });
  grant.accessTokens.add(token);
  return token;
}

function tokenBody(grant, accessToken, refreshToken) {
  return {
    access_token: accessToken,
    expires_in: ACCESS_TOKEN_S,
    ...(refreshToken ? { refresh_token: refreshToken } : {}),
    scope: grant.scopes.join(" "),
    token_type: "Bearer",
    ...(grant.scopes.includes("openid") ? { id_token: idToken(grant) } : {}),
  };
}

function exchangeCode(form) {
  const entry = codes.get(String(form.code ?? ""));
  if (!entry) return oauthError("invalid_grant", "Malformed auth code.");
  if (entry.used || Date.now() - entry.createdAt > CODE_TTL_MS) return oauthError("invalid_grant", "Bad Request");
  if (form.client_id !== entry.clientId) return oauthError("invalid_grant", "Bad Request");
  if (form.redirect_uri !== entry.redirectUri) return oauthError("redirect_uri_mismatch", "Bad Request");
  if (entry.challenge && !form.code_verifier) return oauthError("invalid_grant", "Missing code verifier.");
  if (!pkceMatches(form.code_verifier, entry.challenge, entry.challengeMethod)) return oauthError("invalid_grant", "Invalid code verifier.");
  entry.used = true;
  const consent = consents.get(`${entry.address}|${entry.clientId}`);
  // Google gives a refresh token on the first consent, and again only when the consent is asked for ([F1]).
  const giveRefresh = entry.offline && (entry.forceConsent || !consent?.refreshGiven);
  const grant = { address: entry.address, clientId: entry.clientId, clientSecret: form.client_secret, scopes: entry.scopes, refreshToken: null, revoked: false, accessTokens: new Set() };
  if (giveRefresh) {
    grant.refreshToken = `1//0${randomToken(48)}`;
    refreshGrants.set(grant.refreshToken, grant);
    if (consent) consent.refreshGiven = true;
  }
  mailboxFor(entry.address).grants.push(grant);
  return ok(tokenBody(grant, issueAccess(grant), grant.refreshToken));
}

function refresh(form) {
  const grant = refreshGrants.get(String(form.refresh_token ?? ""));
  if (!grant || grant.revoked) return oauthError("invalid_grant", "Token has been expired or revoked.");
  if (form.client_id !== grant.clientId) return oauthError("unauthorized_client", "Unauthorized", 401);
  if (form.client_secret !== grant.clientSecret) return oauthError("invalid_client", "Unauthorized", 401);
  return ok(tokenBody(grant, issueAccess(grant), null));
}

function token({ body }) {
  const form = formOf(body);
  if (!form.client_id) return oauthError("invalid_request", "Missing required parameter: client_id");
  if (!form.client_secret) return oauthError("invalid_request", "client_secret is missing.");
  if (form.grant_type === "authorization_code") return exchangeCode(form);
  if (form.grant_type === "refresh_token") return refresh(form);
  return oauthError("unsupported_grant_type", `Invalid grant_type: ${form.grant_type ?? ""}`);
}

function revoke({ query, body }) {
  const value = String(formOf(body).token ?? query.token ?? "");
  const grant = refreshGrants.get(value) ?? accessTokens.get(value)?.grant;
  if (!grant || grant.revoked) return oauthError("invalid_token", "Token expired or revoked");
  revokeGrant(grant);
  return ok({});
}

/** @type {import("../server.mjs").MockRoute[]} */
export const googleOAuthRoutes = [
  { method: "GET", path: "/o/oauth2/v2/auth", handle: authorizeRequest },
  { method: "GET", path: "/o/oauth2/v2/auth/decision", handle: decision },
  { method: "POST", path: "/token", handle: token },
  { method: "POST", path: "/revoke", handle: revoke },
];

/** @type {import("../server.mjs").MockRoute[]} */
export const gmailRoutes = [
  { method: "GET", path: "/__mailboxes/**", handle: mailboxControl },
  { method: "POST", path: "/__mailboxes/**", handle: mailboxControl },
  ...["GET", "POST", "PUT", "PATCH", "DELETE"].map((method) => ({ method, path: "/gmail/v1/users/**", handle: gmailApi })),
];
