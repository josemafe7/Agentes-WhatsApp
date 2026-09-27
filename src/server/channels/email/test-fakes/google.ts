// A fake Gmail API and Google OAuth for the email tests (never the real Google, docs/testing.md).
import "server-only";
import { json, record, type RecordedCall } from "./http";

export const GMAIL_BASE = "https://gmail.test";
export const GOOGLE_OAUTH_BASE = "https://accounts.google.test";

export type FakeGmailMessage = { id: string; threadId: string; labelIds: string[]; raw: Buffer; internalDate: number; sizeEstimate?: number };

/** The header lines of a raw message, unfolded, as Gmail's format=metadata lists them in payload.headers. */
function headerPairs(raw: Buffer): { name: string; value: string }[] {
  const text = raw.toString("utf8");
  const end = text.search(/\r?\n\r?\n/);
  const block = (end >= 0 ? text.slice(0, end) : text).replace(/\r?\n[ \t]+/g, " ");
  return block
    .split(/\r?\n/)
    .map((line) => ({ name: line.slice(0, Math.max(0, line.indexOf(":"))).trim(), value: line.slice(line.indexOf(":") + 1).trim() }))
    .filter((pair) => pair.name.length > 0);
}

export function fakeGoogle(options: { emailAddress?: string; historyId?: string; scope?: string } = {}) {
  const state = {
    emailAddress: options.emailAddress ?? "hola@negocio.test",
    historyId: Number(options.historyId ?? 100),
    messages: new Map<string, FakeGmailMessage>(),
    history: [] as { historyId: number; ids: string[] }[],
    drafts: new Map<string, { id: string; raw: string; threadId: string | null }>(),
    sent: [] as { id: string; raw: Buffer; threadId: string | null; viaDraft: string | null }[],
    labels: [{ id: "INBOX", name: "INBOX" }] as { id: string; name: string }[],
    modified: [] as { id: string; addLabelIds: string[] }[],
    historyExpired: false,
    tokenError: null as string | null,
    tokenScope: options.scope ?? "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.modify",
    unauthorizedOnce: false,
    counter: 0,
  };
  const calls: RecordedCall[] = [];
  const nextId = () => `m${(++state.counter).toString(16).padStart(6, "0")}`;

  function addMessage(raw: Buffer, options: { labels?: string[]; threadId?: string; id?: string; sizeEstimate?: number } = {}): FakeGmailMessage {
    const id = options.id ?? nextId();
    const message = { id, threadId: options.threadId ?? `t-${id}`, labelIds: options.labels ?? ["INBOX", "UNREAD"], raw, internalDate: Date.parse("2026-09-27T09:00:00Z"), sizeEstimate: options.sizeEstimate };
    state.messages.set(id, message);
    state.historyId += 1;
    state.history.push({ historyId: state.historyId, ids: [id] });
    return message;
  }

  const oauthFetch: typeof fetch = async (input, init) => {
    const call = await record(calls, input, init);
    const form = new URLSearchParams(call.body ?? "");
    if (call.url.pathname === "/token") {
      if (state.tokenError) return json({ error: state.tokenError, error_description: "Token has been expired or revoked." }, 400);
      const refresh = form.get("grant_type") === "authorization_code";
      return json({
        access_token: `ya29.token-${++state.counter}`,
        expires_in: 3599,
        scope: state.tokenScope,
        token_type: "Bearer",
        ...(refresh ? { refresh_token: "1//refresh-token", id_token: idToken({ sub: "1234567890", email: state.emailAddress, email_verified: true }) } : {}),
      });
    }
    if (call.url.pathname === "/revoke") return json({});
    return json({ error: "not_found" }, 404);
  };

  const apiFetch: typeof fetch = async (input, init) => {
    const call = await record(calls, input, init);
    if (state.unauthorizedOnce) {
      state.unauthorizedOnce = false;
      return json({ error: { code: 401, message: "Invalid Credentials", status: "UNAUTHENTICATED" } }, 401);
    }
    const path = call.url.pathname.replace("/gmail/v1/users/me", "");
    const body = call.body ? (JSON.parse(call.body) as Record<string, unknown>) : {};
    if (path === "/profile") return json({ emailAddress: state.emailAddress, historyId: String(state.historyId), messagesTotal: 0, threadsTotal: 0 });
    if (path === "/history") {
      if (state.historyExpired) return json({ error: { code: 404, message: "Requested entity was not found.", status: "NOT_FOUND" } }, 404);
      const start = Number(call.url.searchParams.get("startHistoryId"));
      const records = state.history.filter((item) => item.historyId > start);
      return json({
        history: records.map((item) => ({ id: String(item.historyId), messagesAdded: item.ids.map((id) => ({ message: { id, threadId: state.messages.get(id)?.threadId, labelIds: state.messages.get(id)?.labelIds } })) })),
        historyId: String(state.historyId),
      });
    }
    if (path === "/messages" && call.method === "GET") {
      const label = call.url.searchParams.get("labelIds");
      const list = [...state.messages.values()].filter((message) => !label || message.labelIds.includes(label));
      return json({ messages: list.map((message) => ({ id: message.id, threadId: message.threadId })) });
    }
    const messageMatch = /^\/messages\/([^/]+)$/.exec(path);
    if (messageMatch && call.method === "GET") {
      const message = state.messages.get(messageMatch[1]);
      if (!message) return json({ error: { code: 404, message: "Not Found" } }, 404);
      const base = { id: message.id, threadId: message.threadId, labelIds: message.labelIds, sizeEstimate: message.sizeEstimate ?? message.raw.byteLength, internalDate: String(message.internalDate) };
      const format = call.url.searchParams.get("format") ?? "full";
      if (format === "metadata") return json({ ...base, payload: { mimeType: "text/plain", headers: headerPairs(message.raw) } });
      if (format === "raw") return json({ ...base, raw: message.raw.toString("base64url") });
      return json({ error: { code: 400, message: `Unsupported format ${format}` } }, 400);
    }
    if (path === "/messages/send") {
      const raw = Buffer.from(String(body.raw), "base64url");
      const id = nextId();
      const threadId = typeof body.threadId === "string" ? body.threadId : null;
      state.sent.push({ id, raw, threadId, viaDraft: null });
      addMessage(raw, { labels: ["SENT"], threadId: threadId ?? undefined, id });
      return json({ id, threadId, labelIds: ["SENT"] });
    }
    if (path === "/drafts" && call.method === "POST") {
      const message = body.message as { raw: string; threadId?: string };
      const id = `r-${++state.counter}`;
      state.drafts.set(id, { id, raw: message.raw, threadId: message.threadId ?? null });
      return json({ id, message: { id: nextId(), threadId: message.threadId, labelIds: ["DRAFT"] } });
    }
    if (path === "/drafts/send") {
      const draft = state.drafts.get(String(body.id));
      if (!draft) return json({ error: { code: 404, message: "Not Found" } }, 404);
      const update = body.message as { raw?: string } | undefined;
      const raw = Buffer.from(update?.raw ?? draft.raw, "base64url");
      state.drafts.delete(draft.id);
      const id = nextId();
      state.sent.push({ id, raw, threadId: draft.threadId, viaDraft: draft.id });
      addMessage(raw, { labels: ["SENT"], threadId: draft.threadId ?? undefined, id });
      return json({ id, threadId: draft.threadId, labelIds: ["SENT"] });
    }
    const draftMatch = /^\/drafts\/([^/]+)$/.exec(path);
    if (draftMatch && call.method === "DELETE") {
      if (!state.drafts.delete(draftMatch[1])) return json({ error: { code: 404 } }, 404);
      return new Response(null, { status: 204 });
    }
    if (path === "/labels" && call.method === "GET") return json({ labels: state.labels });
    if (path === "/labels" && call.method === "POST") {
      const label = { id: `Label_${++state.counter}`, name: String(body.name) };
      state.labels.push(label);
      return json(label);
    }
    const modifyMatch = /^\/messages\/([^/]+)\/modify$/.exec(path);
    if (modifyMatch) {
      state.modified.push({ id: modifyMatch[1], addLabelIds: (body.addLabelIds as string[]) ?? [] });
      return json({ id: modifyMatch[1] });
    }
    return json({ error: { code: 404, message: `Unknown ${call.method} ${path}` } }, 404);
  };

  return { state, calls, addMessage, oauthFetch, apiFetch, deps: { fetchImpl: apiFetch, apiBaseUrl: GMAIL_BASE, oauthFetch, oauthBaseUrl: GOOGLE_OAUTH_BASE } };
}

export function idToken(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "RS256", typ: "JWT" })}.${part(claims)}.firma`;
}

