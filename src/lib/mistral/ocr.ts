// Our own Mistral OCR client, plain fetch and no SDK (docs/integracion-mistral-ocr.md). Only what the knowledge
// ingestion needs: POST /v1/ocr for scanned PDFs sent as a base64 data URL (never a public URL), one entry per page,
// and GET /v1/models to test a key. Base URL from MISTRAL_BASE_URL (the e2e mock server in tests) and an injectable
// fetch, so tests never call Mistral. The key only travels in the Authorization header: never logged or returned.
import "server-only";
import { z } from "zod";

export const MISTRAL_DEFAULT_BASE_URL = "https://api.mistral.ai";
/** Today OCR 4.1; the alias may change model (and price) without notice, so the answer's `model` is kept. */
export const MISTRAL_OCR_MODEL = "mistral-ocr-latest";
/** Documented limits per document: checked before calling ([CON-04]). */
export const MISTRAL_OCR_LIMITS = { maxBytes: 50 * 1024 * 1024, maxPages: 1_000 } as const;

const DEFAULT_TIMEOUT_MS = { ocr: 120_000, models: 15_000 } as const;

export function mistralBaseUrl(): string {
  return (process.env.MISTRAL_BASE_URL?.trim() || MISTRAL_DEFAULT_BASE_URL).replace(/\/+$/, "");
}

export type MistralErrorCode = "invalid_key" | "rate_limited" | "server_error" | "bad_request" | "timeout" | "network" | "invalid_response" | "too_large";

const MESSAGES: Record<MistralErrorCode, string> = {
  invalid_key: "La clave de Mistral OCR no es válida. Revísala en Ajustes > IA.",
  rate_limited: "Mistral OCR está recibiendo demasiadas peticiones. Se reintentará en unos minutos.",
  server_error: "Mistral OCR no está disponible ahora mismo. Se reintentará en unos minutos.",
  bad_request: "Mistral OCR no ha podido leer este PDF.",
  timeout: "Mistral OCR ha tardado demasiado. Se reintentará en unos minutos.",
  network: "No se ha podido conectar con Mistral OCR. Se reintentará en unos minutos.",
  invalid_response: "Mistral OCR ha devuelto una respuesta que no se entiende.",
  too_large: "El PDF pasa del límite de Mistral OCR (50 MB y 1.000 páginas).",
};

const RETRYABLE: ReadonlySet<MistralErrorCode> = new Set(["rate_limited", "server_error", "timeout", "network"]);

/** A failed call. `userMessage` is Spanish and safe to show; the key and the document never appear in it. */
export class MistralError extends Error {
  readonly retryable: boolean;
  readonly userMessage: string;

  constructor(
    readonly status: number,
    readonly code: MistralErrorCode,
  ) {
    super(MESSAGES[code]);
    this.name = "MistralError";
    this.userMessage = MESSAGES[code];
    this.retryable = RETRYABLE.has(code);
  }
}

export function isMistralError(error: unknown): error is MistralError {
  return error instanceof MistralError;
}

function errorForStatus(status: number): MistralError {
  if (status === 401 || status === 403) return new MistralError(status, "invalid_key");
  if (status === 429) return new MistralError(status, "rate_limited");
  if (status === 408) return new MistralError(status, "timeout");
  if (status >= 500) return new MistralError(status, "server_error");
  if (status === 413) return new MistralError(status, "too_large");
  return new MistralError(status, "bad_request");
}

// Optional fields of the SDK types (tables, hyperlinks, header, footer, doc_size_bytes…) are not required.
const ocrResponseSchema = z.object({
  pages: z.array(z.object({ index: z.number().int().min(0), markdown: z.string() })),
  model: z.string().nullish(),
  usage_info: z.object({ pages_processed: z.number().int().nullish() }).nullish(),
});

export type OcrPage = { /** 0-based, as Mistral numbers them. */ index: number; markdown: string };
export type OcrResult = { /** The model that actually ran (traceability). */ model: string | null; pages: OcrPage[]; pagesProcessed: number | null };

export type OcrPdfInput = {
  pdf: Uint8Array;
  fileName?: string;
  /** 0-based pages to read (a range per step for long documents); all when omitted. */
  pages?: readonly number[];
  model?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type MistralClient = {
  /** OCR of a PDF without a text layer ([CON-07]): Markdown per page, in page order. */
  ocrPdf(input: OcrPdfInput): Promise<OcrResult>;
  /** «Probar clave»: GET /v1/models; true when the key is accepted. Never throws for a rejected key. */
  checkKey(options?: { signal?: AbortSignal }): Promise<boolean>;
};

export type MistralClientOptions = { apiKey: string; baseUrl?: string; fetchImpl?: typeof fetch };

export function createMistralClient(options: MistralClientOptions): MistralClient {
  const apiKey = options.apiKey.trim();
  const baseUrl = (options.baseUrl ?? mistralBaseUrl()).replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;

  async function send(path: string, init: { method: "GET" | "POST"; body?: unknown; timeoutMs: number; signal?: AbortSignal }): Promise<unknown> {
    if (!apiKey) throw new MistralError(401, "invalid_key");
    const timeout = AbortSignal.timeout(init.timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    let response: Response;
    let text: string;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
          ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        signal,
        cache: "no-store",
      });
      text = await response.text();
    } catch (error) {
      if (init.signal?.aborted) throw error;
      if (timeout.aborted) throw new MistralError(408, "timeout");
      // Network errors may carry the URL or headers in their text: not kept.
      throw new MistralError(0, "network");
    }
    if (!response.ok) throw errorForStatus(response.status);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new MistralError(502, "invalid_response");
    }
  }

  return {
    async ocrPdf(input) {
      if (input.pdf.byteLength > MISTRAL_OCR_LIMITS.maxBytes) throw new MistralError(413, "too_large");
      const body = {
        model: input.model ?? MISTRAL_OCR_MODEL,
        document: {
          type: "document_url",
          document_url: `data:application/pdf;base64,${Buffer.from(input.pdf).toString("base64")}`,
          ...(input.fileName ? { document_name: input.fileName } : {}),
        },
        ...(input.pages && input.pages.length > 0 ? { pages: [...input.pages] } : {}),
        include_image_base64: false,
        // Repeated headers and footers go to their own fields and out of the Markdown: they would dirty the chunks.
        extract_header: true,
        extract_footer: true,
        include_blocks: false,
      };
      const raw = await send("/v1/ocr", { method: "POST", body, timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS.ocr, signal: input.signal });
      const parsed = ocrResponseSchema.safeParse(raw);
      if (!parsed.success) throw new MistralError(502, "invalid_response");
      return {
        model: parsed.data.model ?? null,
        pages: [...parsed.data.pages].sort((a, b) => a.index - b.index).map(({ index, markdown }) => ({ index, markdown })),
        pagesProcessed: parsed.data.usage_info?.pages_processed ?? null,
      };
    },

    async checkKey(call) {
      try {
        await send("/v1/models", { method: "GET", timeoutMs: DEFAULT_TIMEOUT_MS.models, signal: call?.signal });
        return true;
      } catch (error) {
        if (error instanceof MistralError && error.code === "invalid_key") return false;
        throw error;
      }
    },
  };
}
