// A fake Microsoft Graph and Microsoft login for the email tests (never the real Microsoft, docs/testing.md).
import "server-only";
import { json, record, type RecordedCall } from "./http";

export const GRAPH_BASE = "https://graph.test";
export const MS_LOGIN_BASE = "https://login.microsoft.test";

export type FakeGraphMessage = {
  id: string;
  conversationId: string;
  folder: "inbox" | "sentitems" | "drafts";
  mime: Buffer;
  receivedDateTime: string;
  uniqueBody?: string;
  isDraft?: boolean;
  /** PR_MESSAGE_SIZE as Graph would give it: the MIME's length unless the test says otherwise (null: not given). */
  size?: number | null;
};

/** The header lines of a MIME message, unfolded, as internetMessageHeaders lists them. */
function headerPairs(mime: Buffer): { name: string; value: string }[] {
  const text = mime.toString("utf8");
  const end = text.search(/\r?\n\r?\n/);
  const block = (end >= 0 ? text.slice(0, end) : text).replace(/\r?\n[ \t]+/g, " ");
  return block
    .split(/\r?\n/)
    .map((line) => ({ name: line.slice(0, Math.max(0, line.indexOf(":"))).trim(), value: line.slice(line.indexOf(":") + 1).trim() }))
    .filter((pair) => pair.name.length > 0);
}

export function fakeMicrosoft(options: { mail?: string; scope?: string } = {}) {
  const state = {
    mail: options.mail ?? "hola@negocio.test",
    messages: new Map<string, FakeGraphMessage>(),
    delivered: { inbox: [] as string[], sentitems: [] as string[] },
    cursor: { inbox: 0, sentitems: 0 },
    deltaGone: false,
    tokenError: null as { error: string; codes: number[] } | null,
    scope: options.scope ?? "https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/User.Read",
    refreshTokens: [] as string[],
    created: [] as { id: string; replyTo: string; headers: unknown; via: "json" | "mime"; mime: Buffer | null }[],
    patched: [] as { id: string; body: unknown }[],
    sentDrafts: [] as string[],
    deleted: [] as string[],
    rejectHeaders: false,
    /** createReply from our MIME is refused too. */
    rejectMime: false,
    counter: 0,
  };
  const calls: RecordedCall[] = [];

  function addMessage(folder: "inbox" | "sentitems", mime: Buffer, options: { conversationId?: string; uniqueBody?: string; id?: string; size?: number | null } = {}): FakeGraphMessage {
    const id = options.id ?? `AAMk-${++state.counter}`;
    const message = {
      id,
      conversationId: options.conversationId ?? `conv-${id}`,
      folder,
      mime,
      receivedDateTime: "2026-09-27T09:00:00Z",
      uniqueBody: options.uniqueBody,
      size: options.size === undefined ? mime.byteLength : options.size,
    };
    state.messages.set(id, message);
    state.delivered[folder].push(id);
    return message;
  }

  const oauthFetch: typeof fetch = async (input, init) => {
    const call = await record(calls, input, init);
    if (!call.url.pathname.endsWith("/oauth2/v2.0/token")) return json({ error: "not_found" }, 404);
    if (state.tokenError) return json({ error: state.tokenError.error, error_description: `AADSTS${state.tokenError.codes[0]}: error`, error_codes: state.tokenError.codes }, 400);
    const refresh = `rt-${++state.counter}`;
    state.refreshTokens.push(refresh);
    return json({ access_token: `eyJ.access-${state.counter}`, token_type: "Bearer", expires_in: 3600, scope: state.scope, refresh_token: refresh });
  };

  function deltaResponse(folder: "inbox" | "sentitems"): Response {
    if (state.deltaGone) {
      state.deltaGone = false;
      return json({ error: { code: "SyncStateNotFound", message: "gone" } }, 410);
    }
    const ids = state.delivered[folder].slice(state.cursor[folder]);
    state.cursor[folder] = state.delivered[folder].length;
    const value = ids.map((id) => {
      const message = state.messages.get(id);
      return { id, conversationId: message?.conversationId, receivedDateTime: message?.receivedDateTime, isDraft: false };
    });
    return json({ value, "@odata.deltaLink": `${GRAPH_BASE}/v1.0/me/mailFolders/${folder}/messages/delta?$deltatoken=${folder}-${state.cursor[folder]}` });
  }

  const apiFetch: typeof fetch = async (input, init) => {
    const call = await record(calls, input, init);
    const path = decodeURIComponent(call.url.pathname).replace("/v1.0/me", "");
    const isJson = call.headers.get("content-type")?.includes("application/json") ?? false;
    const body = call.body && isJson ? (JSON.parse(call.body) as Record<string, unknown>) : {};
    if (path === "" && call.method === "GET") return json({ id: "user-1", displayName: "Negocio", mail: state.mail, userPrincipalName: state.mail });
    const delta = /^\/mailFolders\/(inbox|sentitems)\/messages\/delta$/.exec(path);
    if (delta) return deltaResponse(delta[1] as "inbox" | "sentitems");
    const value = /^\/messages\/([^/]+)\/\$value$/.exec(path);
    if (value) {
      const message = state.messages.get(value[1]);
      return message ? new Response(new Uint8Array(message.mime), { status: 200 }) : json({ error: { code: "ErrorItemNotFound" } }, 404);
    }
    const reply = /^\/messages\/([^/]+)\/createReply$/.exec(path);
    if (reply) {
      // Our MIME, in base64 as text ([F42]).
      const mime = !isJson && call.body ? Buffer.from(call.body, "base64") : null;
      if (mime && state.rejectMime) return json({ error: { code: "ErrorMimeContentInvalid" } }, 400);
      const headers = mime ? headerPairs(mime).filter((pair) => /^x-/i.test(pair.name)) : (body.message as { internetMessageHeaders?: unknown } | undefined)?.internetMessageHeaders;
      if (!mime && headers && state.rejectHeaders) return json({ error: { code: "InvalidInternetMessageHeader" } }, 400);
      const original = state.messages.get(reply[1]);
      if (!original) return json({ error: { code: "ErrorItemNotFound" } }, 404);
      const id = `AAMk-draft-${++state.counter}`;
      state.messages.set(id, { id, conversationId: original.conversationId, folder: "drafts", mime: mime ?? Buffer.from(""), receivedDateTime: "2026-09-27T10:00:00Z", isDraft: true });
      state.created.push({ id, replyTo: reply[1], headers: headers ?? null, via: mime ? "mime" : "json", mime });
      return json({ id, conversationId: original.conversationId, isDraft: true }, 201);
    }
    const send = /^\/messages\/([^/]+)\/send$/.exec(path);
    if (send) {
      if (!state.messages.has(send[1])) return json({ error: { code: "ErrorItemNotFound" } }, 404);
      state.sentDrafts.push(send[1]);
      return new Response(null, { status: 202 });
    }
    const single = /^\/messages\/([^/]+)$/.exec(path);
    if (single && call.method === "PATCH") {
      if (!state.messages.has(single[1])) return json({ error: { code: "ErrorItemNotFound" } }, 404);
      state.patched.push({ id: single[1], body });
      return json({ id: single[1] });
    }
    if (single && call.method === "DELETE") {
      state.deleted.push(single[1]);
      return state.messages.delete(single[1]) ? new Response(null, { status: 204 }) : json({ error: { code: "ErrorItemNotFound" } }, 404);
    }
    if (single && call.method === "GET") {
      const message = state.messages.get(single[1]);
      if (!message) return json({ error: { code: "ErrorItemNotFound" } }, 404);
      if ((call.url.searchParams.get("$expand") ?? "").includes("0x0E08")) {
        const size = message.size === undefined ? message.mime.byteLength : message.size;
        return json({ id: message.id, ...(size === null ? {} : { singleValueExtendedProperties: [{ id: "Integer 0xe08", value: String(size) }] }) });
      }
      if ((call.url.searchParams.get("$select") ?? "").includes("internetMessageHeaders")) return json({ id: message.id, internetMessageHeaders: headerPairs(message.mime) });
      return json({ uniqueBody: { contentType: "text", content: message.uniqueBody ?? null }, inferenceClassification: "focused" });
    }
    return json({ error: { code: "NotFound", message: `Unknown ${call.method} ${path}` } }, 404);
  };

  return { state, calls, addMessage, oauthFetch, apiFetch, deps: { fetchImpl: apiFetch, apiBaseUrl: GRAPH_BASE, oauthFetch, oauthBaseUrl: MS_LOGIN_BASE } };
}

