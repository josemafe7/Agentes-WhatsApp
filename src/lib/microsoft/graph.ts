// Our own Microsoft Graph client for Outlook / Microsoft 365 mailboxes (docs/integracion-correo.md §2.3–§2.5): the
// user, delta queries of a folder, the size of a message before its MIME (read with a cap), its headers, its unique
// body, createReply (in JSON, or from our MIME) → PATCH (text and only recipient) → send, and deletes.
// Immutable ids everywhere (`Prefer: IdType="ImmutableId"`, [F45]). MS_GRAPH_BASE_URL points at the e2e mock;
// injectable fetch. The token comes from a callback: a 401 asks for a fresh one once. Paging links are only followed
// on Graph's own origin, so the token never leaves for another host.
import "server-only";
import { z } from "zod";

export const DEFAULT_MS_GRAPH_BASE_URL = "https://graph.microsoft.com";
const TIMEOUT_MS = 20_000;
const MIME_TIMEOUT_MS = 60_000;
const IMMUTABLE_ID = 'IdType="ImmutableId"';
const PAGE_SIZE = 50;
/** Graph takes a file attachment in a single request up to 3 MB. */
export const MAX_SIMPLE_ATTACHMENT_BYTES = 3 * 1024 * 1024;
const GRAPH_ID = /^[A-Za-z0-9=_+/-]{1,1024}$/;
/** What the delta query returns of each message: just enough to decide what to read ([F38]). */
const DELTA_SELECT = ["id", "conversationId", "internetMessageId", "receivedDateTime", "isDraft", "from", "parentFolderId"].join(",");

export function msGraphBaseUrl(): string {
  return (process.env.MS_GRAPH_BASE_URL?.trim() || DEFAULT_MS_GRAPH_BASE_URL).replace(/\/+$/, "");
}

const meSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().nullish(),
  mail: z.string().nullish(),
  userPrincipalName: z.string().nullish(),
});
export type GraphMe = z.infer<typeof meSchema>;

const deltaItemSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().nullish(),
  internetMessageId: z.string().nullish(),
  receivedDateTime: z.string().nullish(),
  isDraft: z.boolean().nullish(),
  "@removed": z.unknown().optional(),
});
export type GraphDeltaItem = z.infer<typeof deltaItemSchema>;

const deltaPageSchema = z.object({
  value: z.array(z.unknown()).default([]),
  "@odata.nextLink": z.string().optional(),
  "@odata.deltaLink": z.string().optional(),
});
export type GraphDeltaPage = { items: GraphDeltaItem[]; nextLink: string | null; deltaLink: string | null };

const uniqueBodySchema = z.object({
  uniqueBody: z.object({ content: z.string().nullish() }).nullish(),
  inferenceClassification: z.string().nullish(),
});

const draftSchema = z.object({ id: z.string().min(1), conversationId: z.string().nullish(), internetMessageId: z.string().nullish() });
export type GraphDraft = z.infer<typeof draftSchema>;

/**
 * PR_MESSAGE_SIZE (PidTagMessageSize, property 0x0E08, a 32-bit integer): the size of the message in bytes, read as a
 * single-value extended property because the message resource has no size of its own.
 */
const MESSAGE_SIZE_PROPERTY = "Integer 0x0E08";
const sizeSchema = z.object({ singleValueExtendedProperties: z.array(z.object({ id: z.string(), value: z.string().nullish() })).optional() });
const headersSchema = z.object({ internetMessageHeaders: z.array(z.object({ name: z.string(), value: z.string() })).nullish() });

export type GraphRecipient = { address: string; name: string | null };

const errorBodySchema = z.object({ error: z.object({ code: z.string().optional(), message: z.string().optional() }) });

/** Delta tokens that no longer work: sync again from scratch ([F40]). */
const RESYNC_CODES = new Set(["syncStateNotFound", "syncStateInvalid", "resyncRequired", "InvalidSyncToken"]);

function describe(status: number | null, code: string | null): string {
  if (status === null) return "No se ha podido conectar con Microsoft. Lo reintentamos.";
  if (status === 401) return "Microsoft ya no acepta el acceso a este buzón. Vuelve a conectarlo.";
  if (status === 403) return "A la conexión con Microsoft le falta un permiso (Mail.ReadWrite o Mail.Send).";
  if (status === 404) return "Outlook no encuentra el correo.";
  if (status === 429) return "Microsoft limita las peticiones ahora mismo. Lo reintentamos.";
  if (status >= 500) return "Microsoft no está disponible ahora mismo. Lo reintentamos.";
  if (code && RESYNC_CODES.has(code)) return "Outlook pide volver a sincronizar la bandeja.";
  return "Microsoft ha rechazado la petición.";
}

export class GraphApiError extends Error {
  readonly userMessage: string;
  constructor(
    readonly httpStatus: number | null,
    readonly code: string | null,
    /** From Retry-After on a 429 ([F47]). */
    readonly retryAfterMs: number | null = null,
  ) {
    super(`Graph ${httpStatus ?? "network"}${code ? ` ${code}` : ""}`);
    this.name = "GraphApiError";
    this.userMessage = describe(httpStatus, code);
  }
  get retryable(): boolean {
    return this.httpStatus === null || this.httpStatus === 429 || this.httpStatus >= 500;
  }
  /** 410 Gone or an expired sync state: start the delta again ([F40]). */
  get resync(): boolean {
    return this.httpStatus === 410 || (this.code !== null && RESYNC_CODES.has(this.code));
  }
}

export type GraphTokenProvider = (options: { forceRefresh: boolean }) => Promise<string>;
export type GraphClientOptions = { getAccessToken: GraphTokenProvider; baseUrl?: string; fetchImpl?: typeof fetch };

type Call = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  url: string;
  body?: unknown;
  /** A body sent as it is with its own type (the base64 MIME of createReply) instead of JSON. */
  text?: { body: string; contentType: string };
  prefer?: string[];
  timeoutMs?: number;
  raw?: boolean;
};

/** Reads a response body up to `maxBytes` and stops there: a huge message never sits whole in memory. */
async function readCapped(response: Response, maxBytes: number): Promise<{ bytes: Buffer; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) return { bytes: Buffer.alloc(0), truncated: false };
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return { bytes: Buffer.concat(chunks), truncated: false };
    const room = maxBytes - total;
    if (value.byteLength > room) {
      chunks.push(value.subarray(0, Math.max(0, room)));
      await reader.cancel().catch(() => undefined);
      return { bytes: Buffer.concat(chunks), truncated: true };
    }
    chunks.push(value);
    total += value.byteLength;
  }
}

function retryAfter(response: Response): number | null {
  const value = Number(response.headers.get("retry-after"));
  return Number.isFinite(value) && value > 0 ? Math.min(value, 600) * 1_000 : null;
}

function idPath(id: string): string {
  if (!GRAPH_ID.test(id)) throw new GraphApiError(400, "invalid_id");
  return encodeURIComponent(id);
}

export function createGraphClient(options: GraphClientOptions) {
  const base = (options.baseUrl ?? msGraphBaseUrl()).replace(/\/+$/, "");
  const origin = new URL(base).origin;
  const api = `${base}/v1.0/me`;
  const fetcher = options.fetchImpl ?? fetch;

  async function call(input: Call, forceRefresh = false): Promise<Response> {
    if (new URL(input.url).origin !== origin) throw new GraphApiError(400, "foreign_link");
    const token = await options.getAccessToken({ forceRefresh });
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Prefer: [IMMUTABLE_ID, ...(input.prefer ?? [])].join(", ") };
    if (input.text) headers["Content-Type"] = input.text.contentType;
    else if (input.body !== undefined) headers["Content-Type"] = "application/json";
    if (!input.raw) headers.Accept = "application/json";
    let response: Response;
    try {
      response = await fetcher(input.url, {
        method: input.method ?? "GET",
        headers,
        // «send» takes an empty body with Content-Length: 0 ([F43]).
        body: input.text ? input.text.body : input.body !== undefined ? JSON.stringify(input.body) : input.method === "POST" ? "" : undefined,
        signal: AbortSignal.timeout(input.timeoutMs ?? TIMEOUT_MS),
      });
    } catch {
      throw new GraphApiError(null, null);
    }
    if (response.status === 401 && !forceRefresh) return call(input, true);
    if (!response.ok) {
      const parsed = errorBodySchema.safeParse(await response.json().catch(() => null));
      throw new GraphApiError(response.status, parsed.success ? (parsed.data.error.code ?? null) : null, retryAfter(response));
    }
    return response;
  }

  async function json<T extends z.ZodType>(schema: T, input: Call): Promise<z.infer<T>> {
    const response = await call(input);
    const parsed = schema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new GraphApiError(502, "invalid_response");
    return parsed.data;
  }

  return {
    async getMe(): Promise<GraphMe> {
      return json(meSchema, { url: `${api}?$select=id,displayName,mail,userPrincipalName` });
    },
    /** First URL of a folder's delta: only new messages, received since `since` ([F38], [F39]). */
    initialDeltaUrl(folder: "inbox" | "sentitems", since: Date): string {
      const url = new URL(`${api}/mailFolders/${folder}/messages/delta`);
      url.searchParams.set("changeType", "created");
      url.searchParams.set("$select", DELTA_SELECT);
      url.searchParams.set("$filter", `receivedDateTime ge ${since.toISOString().replace(/\.\d{3}Z$/, "Z")}`);
      return url.toString();
    },
    /** One page of a delta round: follow nextLink until deltaLink ([F40]). */
    async deltaPage(url: string): Promise<GraphDeltaPage> {
      const page = await json(deltaPageSchema, { url, prefer: [`odata.maxpagesize=${PAGE_SIZE}`] });
      const items = page.value.flatMap((item) => {
        const parsed = deltaItemSchema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      });
      return { items, nextLink: page["@odata.nextLink"] ?? null, deltaLink: page["@odata.deltaLink"] ?? null };
    },
    /**
     * The size of a message in bytes, asked before its MIME ([COR-19]): null when Graph does not give it (then the MIME
     * is read with its own cap).
     */
    async getMessageSize(id: string): Promise<number | null> {
      const url = new URL(`${api}/messages/${idPath(id)}`);
      url.searchParams.set("$select", "id");
      url.searchParams.set("$expand", `singleValueExtendedProperties($filter=id eq '${MESSAGE_SIZE_PROPERTY}')`);
      const found = await json(sizeSchema, { url: url.toString() });
      const value = Number(found.singleValueExtendedProperties?.[0]?.value);
      return Number.isSafeInteger(value) && value >= 0 ? value : null;
    },
    /** Only the headers of a message, for one too big to read whole ([F44]). */
    async getMessageHeaders(id: string): Promise<{ name: string; value: string }[]> {
      return (await json(headersSchema, { url: `${api}/messages/${idPath(id)}?$select=internetMessageHeaders` })).internetMessageHeaders ?? [];
    },
    /** The MIME message ([F50]), parsed like IMAP's; reading stops past `maxBytes` (`truncated`: only its start came). */
    async getMimeMessage(id: string, options: { maxBytes: number }): Promise<{ bytes: Buffer; truncated: boolean }> {
      const response = await call({ url: `${api}/messages/${idPath(id)}/$value`, raw: true, timeoutMs: MIME_TIMEOUT_MS });
      return readCapped(response, options.maxBytes);
    },
    /** The body without the quoted history, as text ([F44], [F46]). */
    async getUniqueBody(id: string): Promise<{ text: string | null; inferenceClassification: string | null }> {
      const body = await json(uniqueBodySchema, {
        url: `${api}/messages/${idPath(id)}?$select=uniqueBody,inferenceClassification`,
        prefer: ['outlook.body-content-type="text"'],
      });
      return { text: body.uniqueBody?.content ?? null, inferenceClassification: body.inferenceClassification ?? null };
    },
    /** A reply draft; `x-` headers can only be set now, at creation ([F44]). */
    async createReply(id: string, input: { headers?: Record<string, string> } = {}): Promise<GraphDraft> {
      const headers = Object.entries(input.headers ?? {}).map(([name, value]) => ({ name, value }));
      const body = headers.length > 0 ? { message: { internetMessageHeaders: headers } } : {};
      return json(draftSchema, { method: "POST", url: `${api}/messages/${idPath(id)}/createReply`, body });
    },
    /** A file of up to 3 MB on a draft, in one request (bigger ones need an upload session). */
    async addFileAttachment(id: string, file: { name: string; contentType: string; content: Buffer }): Promise<void> {
      if (file.content.byteLength > MAX_SIMPLE_ATTACHMENT_BYTES) throw new GraphApiError(413, "attachment_too_large");
      await call({
        method: "POST",
        url: `${api}/messages/${idPath(id)}/attachments`,
        body: { "@odata.type": "#microsoft.graph.fileAttachment", name: file.name, contentType: file.contentType, contentBytes: file.content.toString("base64") },
      });
    },
    /**
     * The same reply draft created from our MIME message, in base64 as text ([F42]): the only way to give it headers
     * that Graph does not take in JSON.
     */
    async createReplyMime(id: string, mime: Buffer): Promise<GraphDraft> {
      return json(draftSchema, { method: "POST", url: `${api}/messages/${idPath(id)}/createReply`, text: { body: mime.toString("base64"), contentType: "text/plain" } });
    },
    /** A draft's text and, when given, its only recipients (a draft's recipients can change, [F46]). */
    async updateDraft(id: string, input: { text?: string; to?: readonly GraphRecipient[] }): Promise<void> {
      const body = {
        ...(input.text !== undefined ? { body: { contentType: "Text", content: input.text } } : {}),
        ...(input.to ? { toRecipients: input.to.map((item) => ({ emailAddress: { address: item.address, ...(item.name ? { name: item.name } : {}) } })) } : {}),
      };
      await call({ method: "PATCH", url: `${api}/messages/${idPath(id)}`, body });
    },
    /** 202 without body ([F43]). */
    async sendDraft(id: string): Promise<void> {
      await call({ method: "POST", url: `${api}/messages/${idPath(id)}/send` });
    },
    async deleteMessage(id: string): Promise<void> {
      await call({ method: "DELETE", url: `${api}/messages/${idPath(id)}` });
    },
  };
}

export type GraphClient = ReturnType<typeof createGraphClient>;
