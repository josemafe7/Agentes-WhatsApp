// A fake Microsoft Graph and Microsoft login for the email tests (never the real Microsoft, docs/testing.md).
import "server-only";
import { json, record, type RecordedCall } from "./http";

export const GRAPH_BASE = "https://graph.test";
export const MS_LOGIN_BASE = "https://login.microsoft.test";

export type FakeGraphMessage = { id: string; conversationId: string; folder: "inbox" | "sentitems" | "drafts"; mime: Buffer; receivedDateTime: string; uniqueBody?: string; isDraft?: boolean };

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
    created: [] as { id: string; replyTo: string; headers: unknown }[],
    patched: [] as { id: string; body: unknown }[],
    sentDrafts: [] as string[],
    deleted: [] as string[],
    rejectHeaders: false,
    counter: 0,
  };
  const calls: RecordedCall[] = [];

  function addMessage(folder: "inbox" | "sentitems", mime: Buffer, options: { conversationId?: string; uniqueBody?: string; id?: string } = {}): FakeGraphMessage {
    const id = options.id ?? `AAMk-${++state.counter}`;
    const message = { id, conversationId: options.conversationId ?? `conv-${id}`, folder, mime, receivedDateTime: "2026-09-27T09:00:00Z", uniqueBody: options.uniqueBody };
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
    const body = call.body ? (JSON.parse(call.body) as Record<string, unknown>) : {};
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
      const headers = (body.message as { internetMessageHeaders?: unknown } | undefined)?.internetMessageHeaders;
      if (headers && state.rejectHeaders) return json({ error: { code: "InvalidInternetMessageHeader" } }, 400);
      const original = state.messages.get(reply[1]);
      if (!original) return json({ error: { code: "ErrorItemNotFound" } }, 404);
      const id = `AAMk-draft-${++state.counter}`;
      state.messages.set(id, { id, conversationId: original.conversationId, folder: "drafts", mime: Buffer.from(""), receivedDateTime: "2026-09-27T10:00:00Z", isDraft: true });
      state.created.push({ id, replyTo: reply[1], headers: headers ?? null });
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
      return message ? json({ uniqueBody: { contentType: "text", content: message.uniqueBody ?? null }, inferenceClassification: "focused" }) : json({ error: {} }, 404);
    }
    return json({ error: { code: "NotFound", message: `Unknown ${call.method} ${path}` } }, 404);
  };

  return { state, calls, addMessage, oauthFetch, apiFetch, deps: { fetchImpl: apiFetch, apiBaseUrl: GRAPH_BASE, oauthFetch, oauthBaseUrl: MS_LOGIN_BASE } };
}

