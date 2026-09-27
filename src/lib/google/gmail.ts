// Our own Gmail API client (docs/integracion-correo.md §1.4–§1.6): profile, history, list, raw messages, send, drafts,
// labels and modify. Base URL from GOOGLE_API_BASE_URL (the e2e mock) or Google's; injectable fetch. The access token
// comes from a callback: a 401 asks it for a fresh one once and repeats the call ([F21]). Responses are parsed with
// Zod; failures become GmailApiError with a Spanish, secret-free message.
import "server-only";
import { z } from "zod";

export const DEFAULT_GOOGLE_API_BASE_URL = "https://gmail.googleapis.com";
const TIMEOUT_MS = 20_000;
const SEND_TIMEOUT_MS = 60_000;
/** Gmail ids are hex-ish tokens: nothing else is put into a path. */
const GMAIL_ID = /^[A-Za-z0-9_-]{1,200}$/;

export function googleApiBaseUrl(): string {
  return (process.env.GOOGLE_API_BASE_URL?.trim() || DEFAULT_GOOGLE_API_BASE_URL).replace(/\/+$/, "");
}

const profileSchema = z.object({ emailAddress: z.string().min(3).max(254), historyId: z.string().min(1).max(40) });
export type GmailProfile = z.infer<typeof profileSchema>;

const messageRefSchema = z.object({ id: z.string().min(1), threadId: z.string().optional(), labelIds: z.array(z.string()).optional() });
export type GmailMessageRef = z.infer<typeof messageRefSchema>;

const historyPageSchema = z.object({
  history: z
    .array(
      z.object({
        id: z.string().optional(),
        messagesAdded: z.array(z.object({ message: messageRefSchema })).optional(),
        labelsAdded: z.array(z.object({ message: messageRefSchema, labelIds: z.array(z.string()).optional() })).optional(),
      }),
    )
    .optional(),
  nextPageToken: z.string().optional(),
  historyId: z.string().min(1),
});
export type GmailHistoryPage = z.infer<typeof historyPageSchema>;

const messageListSchema = z.object({ messages: z.array(messageRefSchema).optional(), nextPageToken: z.string().optional() });

const rawMessageSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  labelIds: z.array(z.string()).default([]),
  sizeEstimate: z.number().int().nonnegative().optional(),
  internalDate: z.string().optional(),
  raw: z.string().optional(),
});
export type GmailRawMessage = z.infer<typeof rawMessageSchema>;

const metadataMessageSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  labelIds: z.array(z.string()).default([]),
  sizeEstimate: z.number().int().nonnegative().optional(),
  internalDate: z.string().optional(),
  payload: z.object({ headers: z.array(z.object({ name: z.string(), value: z.string() })).default([]) }).optional(),
});
export type GmailMessageMetadata = Omit<z.infer<typeof metadataMessageSchema>, "payload"> & { headers: { name: string; value: string }[] };

const sentMessageSchema = z.object({ id: z.string().min(1), threadId: z.string().optional(), labelIds: z.array(z.string()).optional() });
export type GmailSentMessage = z.infer<typeof sentMessageSchema>;

const draftSchema = z.object({ id: z.string().min(1), message: sentMessageSchema.optional() });
export type GmailDraft = z.infer<typeof draftSchema>;

const labelSchema = z.object({ id: z.string().min(1), name: z.string(), type: z.string().optional() });
export type GmailLabel = z.infer<typeof labelSchema>;
const labelListSchema = z.object({ labels: z.array(labelSchema).default([]) });

const errorBodySchema = z.object({
  error: z.object({
    code: z.number().optional(),
    message: z.string().optional(),
    status: z.string().optional(),
    errors: z.array(z.object({ reason: z.string().optional() })).optional(),
  }),
});

const RATE_REASONS = new Set(["dailyLimitExceeded", "userRateLimitExceeded", "rateLimitExceeded", "backendError"]);

/** Spanish message of a Gmail failure (never the token or the message contents). */
function describe(status: number | null, reason: string | null): string {
  if (status === null) return "No se ha podido conectar con Gmail. Lo reintentamos.";
  if (status === 401) return "Google ya no acepta el acceso a este buzón. Vuelve a conectarlo.";
  if (reason === "domainPolicy") return "El administrador de Google Workspace ha bloqueado el acceso de apps a Gmail.";
  if (status === 429 || (status === 403 && reason && RATE_REASONS.has(reason))) return "Gmail limita las peticiones ahora mismo. Lo reintentamos.";
  if (status === 403) return "A la conexión con Gmail le falta un permiso. Vuelve a conectarla.";
  if (status === 404) return "Gmail no encuentra lo que se pedía.";
  if (status >= 500) return "Gmail no está disponible ahora mismo. Lo reintentamos.";
  return "Gmail ha rechazado la petición.";
}

export class GmailApiError extends Error {
  readonly userMessage: string;
  constructor(
    readonly httpStatus: number | null,
    readonly reason: string | null,
  ) {
    super(`Gmail API ${httpStatus ?? "network"}${reason ? ` ${reason}` : ""}`);
    this.name = "GmailApiError";
    this.userMessage = describe(httpStatus, reason);
  }
  /** Transient: quota, concurrency, server or network ([F21]). */
  get retryable(): boolean {
    const status = this.httpStatus;
    return status === null || status === 429 || status >= 500 || (status === 403 && this.reason !== null && RATE_REASONS.has(this.reason));
  }
}

export type GmailTokenProvider = (options: { forceRefresh: boolean }) => Promise<string>;

export type GmailClientOptions = { getAccessToken: GmailTokenProvider; baseUrl?: string; fetchImpl?: typeof fetch };

type RequestInput = { method?: "GET" | "POST" | "PUT" | "DELETE"; path: string; query?: [string, string][]; body?: unknown; timeoutMs?: number };

function assertId(id: string): string {
  if (!GMAIL_ID.test(id)) throw new GmailApiError(400, "invalid_id");
  return id;
}

export function createGmailClient(options: GmailClientOptions) {
  const base = `${(options.baseUrl ?? googleApiBaseUrl()).replace(/\/+$/, "")}/gmail/v1/users/me`;
  const fetcher = options.fetchImpl ?? fetch;

  async function call(input: RequestInput, forceRefresh = false): Promise<unknown> {
    const token = await options.getAccessToken({ forceRefresh });
    const url = new URL(`${base}${input.path}`);
    for (const [key, value] of input.query ?? []) url.searchParams.append(key, value);
    let response: Response;
    try {
      response = await fetcher(url.toString(), {
        method: input.method ?? "GET",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(input.body !== undefined ? { "Content-Type": "application/json" } : {}) },
        body: input.body !== undefined ? JSON.stringify(input.body) : undefined,
        signal: AbortSignal.timeout(input.timeoutMs ?? TIMEOUT_MS),
      });
    } catch {
      throw new GmailApiError(null, null);
    }
    if (response.status === 401 && !forceRefresh) return call(input, true);
    if (response.status === 204) return null;
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const parsed = errorBodySchema.safeParse(body);
      const reason = parsed.success ? (parsed.data.error.errors?.[0]?.reason ?? parsed.data.error.status ?? null) : null;
      throw new GmailApiError(response.status, reason);
    }
    return body;
  }

  function parse<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new GmailApiError(502, "invalid_response");
    return parsed.data;
  }

  return {
    async getProfile(): Promise<GmailProfile> {
      return parse(profileSchema, await call({ path: "/profile" }));
    },
    /** Every change since `startHistoryId`, without labelId: messages are classified by their labels ([F13]). */
    async listHistory(input: { startHistoryId: string; pageToken?: string | null }): Promise<GmailHistoryPage> {
      const query: [string, string][] = [
        ["startHistoryId", input.startHistoryId],
        ["historyTypes", "messageAdded"],
        ["historyTypes", "labelAdded"],
        ["maxResults", "500"],
      ];
      if (input.pageToken) query.push(["pageToken", input.pageToken]);
      return parse(historyPageSchema, await call({ path: "/history", query }));
    },
    async listMessages(input: { labelIds?: string[]; q?: string; pageToken?: string | null; maxResults?: number }) {
      const query: [string, string][] = [["maxResults", String(input.maxResults ?? 100)]];
      for (const label of input.labelIds ?? []) query.push(["labelIds", label]);
      if (input.q) query.push(["q", input.q]);
      if (input.pageToken) query.push(["pageToken", input.pageToken]);
      return parse(messageListSchema, await call({ path: "/messages", query }));
    },
    /**
     * Labels, size and headers of a message without its body (format=metadata, [F14]): read first, so a message too big
     * to read whole is never downloaded ([COR-19]).
     */
    async getMessageMetadata(id: string): Promise<GmailMessageMetadata> {
      const { payload, ...message } = parse(metadataMessageSchema, await call({ path: `/messages/${assertId(id)}`, query: [["format", "metadata"]] }));
      return { ...message, headers: payload?.headers ?? [] };
    },
    /** The whole RFC 2822 message in `raw` (base64url), parsed later like IMAP's ([F14]). */
    async getRawMessage(id: string): Promise<GmailRawMessage> {
      return parse(rawMessageSchema, await call({ path: `/messages/${assertId(id)}`, query: [["format", "raw"]] }));
    },
    async sendMessage(input: { raw: string; threadId?: string | null }): Promise<GmailSentMessage> {
      return parse(sentMessageSchema, await call({ method: "POST", path: "/messages/send", body: { raw: input.raw, ...(input.threadId ? { threadId: input.threadId } : {}) }, timeoutMs: SEND_TIMEOUT_MS }));
    },
    async createDraft(input: { raw: string; threadId?: string | null }): Promise<GmailDraft> {
      return parse(draftSchema, await call({ method: "POST", path: "/drafts", body: { message: { raw: input.raw, ...(input.threadId ? { threadId: input.threadId } : {}) } }, timeoutMs: SEND_TIMEOUT_MS }));
    },
    /** Sends an existing draft, replaced first by `raw` when given ([F19]). */
    async sendDraft(input: { id: string; raw?: string; threadId?: string | null }): Promise<GmailSentMessage> {
      const message = input.raw ? { message: { raw: input.raw, ...(input.threadId ? { threadId: input.threadId } : {}) } } : {};
      return parse(sentMessageSchema, await call({ method: "POST", path: "/drafts/send", body: { id: assertId(input.id), ...message }, timeoutMs: SEND_TIMEOUT_MS }));
    },
    async deleteDraft(id: string): Promise<void> {
      await call({ method: "DELETE", path: `/drafts/${assertId(id)}` });
    },
    async listLabels(): Promise<GmailLabel[]> {
      return parse(labelListSchema, await call({ path: "/labels" })).labels;
    },
    async createLabel(name: string): Promise<GmailLabel> {
      return parse(labelSchema, await call({ method: "POST", path: "/labels", body: { name, labelListVisibility: "labelShow", messageListVisibility: "show" } }));
    },
    async addLabels(messageId: string, labelIds: string[]): Promise<void> {
      await call({ method: "POST", path: `/messages/${assertId(messageId)}/modify`, body: { addLabelIds: labelIds } });
    },
  };
}

export type GmailClient = ReturnType<typeof createGmailClient>;

/** base64url of a MIME message, as Gmail's `raw` wants it. */
export function toGmailRaw(message: Uint8Array): string {
  return Buffer.from(message).toString("base64url");
}

export function fromGmailRaw(raw: string): Buffer {
  return Buffer.from(raw, "base64url");
}
