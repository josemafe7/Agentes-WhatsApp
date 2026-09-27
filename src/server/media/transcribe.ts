// Transcribes a customer's audio ([MED-01]–[MED-03]): the model of Settings › IA, in Spanish, at most 60 s in all.
// The note goes as it is; if the model rejects its format, it is converted to MP3 with FFmpeg and sent again; if
// that fails too, the fallback transcription model gets it, but only when every provider of that model is in the
// zero-retention list ([CUM-10]). Every call is recorded in ai_runs with its cost.
// Transcription takes no data_collection or zdr: its privacy comes from the model (docs/integracion-openrouter.md §9).
import "server-only";
import { recordAiRun } from "@/data/ai-runs";
import { TRANSCRIPTION_TIMEOUT_MS, type OpenRouterClient } from "@/lib/openrouter/client";
import { DEFAULT_MODELS } from "@/lib/openrouter/default-models";
import { isOpenRouterError, type OpenRouterErrorCode } from "@/lib/openrouter/errors";
import type { TranscriptionResult } from "@/lib/openrouter/types";
import { safeErrorMessage } from "@/server/redact";
import { convertToMp3WithFfmpeg, FFMPEG_TIMEOUT_MS, type FfmpegRunner } from "./ffmpeg";
import { extensionForMime, MEDIA_LIMITS, transcriptionFormat } from "./limits";

/**
 * «Transcripción de respaldo» of docs/integracion-openrouter.md §10: another provider (Mistral). Today only its
 * `mistral/eu` endpoint is zero-retention, so it is only tried if that changes (see TranscribeDeps.fallbackAllowed).
 */
export const TRANSCRIPTION_FALLBACK_MODEL = "mistralai/voxtral-mini-transcribe";
/** [MED-01]: the audios are transcribed in Spanish. */
export const TRANSCRIPTION_LANGUAGE = "es";

/** The format was not accepted: worth converting to MP3. */
const FORMAT_REJECTED: ReadonlySet<OpenRouterErrorCode> = new Set(["bad_request", "unprocessable", "payload_too_large"]);
/** The key or the credit: any other try fails the same way. */
const ACCOUNT_PROBLEM: ReadonlySet<OpenRouterErrorCode> = new Set(["invalid_key", "no_credits", "key_limit"]);
const UNEXPECTED_ERROR = "La transcripción ha fallado por un error inesperado.";

export type TranscribeInput = {
  bytes: Uint8Array;
  mimeType: string;
  conversationId?: string | null;
  /** The audio message: its cost is recorded against it. */
  messageId?: string | null;
  agentId?: string | null;
};

export type TranscribeDeps = {
  client: OpenRouterClient;
  /** Transcription model of Settings › IA. */
  model: string;
  ffmpeg?: FfmpegRunner;
  /** Epoch ms by which everything must end (the job's budget); 60 s from the start in any case. */
  deadlineAt?: number;
  clock?: () => number;
  /**
   * Whether every provider of the fallback model is in OpenRouter's zero-retention list ([CUM-10]): the audio's
   * privacy comes from the model, and Settings › IA only warns about the chosen one. Without it (or when it says no
   * or cannot tell) the fallback is not tried.
   */
  fallbackAllowed?: (model: string) => Promise<boolean>;
};

export type TranscribeOutcome = { ok: true; text: string; model: string } | { ok: false; reason: "too_large" | "empty" | "failed" };

type Audio = { bytes: Uint8Array; format: string };
type Attempt = { text: string } | { error: OpenRouterErrorCode | "unexpected" };

/** The model of Settings, then a fallback of another provider. */
export function transcriptionModels(primary: string): string[] {
  const fallback = primary === TRANSCRIPTION_FALLBACK_MODEL ? DEFAULT_MODELS.transcription : TRANSCRIPTION_FALLBACK_MODEL;
  return [primary, fallback];
}

async function attempt(input: TranscribeInput, deps: TranscribeDeps, model: string, audio: Audio, timeoutMs: number): Promise<Attempt> {
  const clock = deps.clock ?? Date.now;
  const started = clock();
  let result: TranscriptionResult | null = null;
  let error: OpenRouterErrorCode | "unexpected" | null = null;
  let message: string | null = null;
  try {
    result = await deps.client.transcribe(
      { model, audioBase64: Buffer.from(audio.bytes).toString("base64"), format: audio.format, language: TRANSCRIPTION_LANGUAGE, sessionId: input.conversationId },
      { timeoutMs },
    );
  } catch (caught) {
    error = isOpenRouterError(caught) ? caught.code : "unexpected";
    message = isOpenRouterError(caught) ? caught.userMessage : UNEXPECTED_ERROR;
    if (!isOpenRouterError(caught)) console.warn(`[media] Fallo inesperado al transcribir: ${safeErrorMessage(caught)}`);
  }
  await recordAiRun({
    kind: "transcription",
    mode: "live",
    conversationId: input.conversationId ?? null,
    messageId: input.messageId ?? null,
    agentId: input.agentId ?? null,
    modelRequested: model,
    modelUsed: result ? model : null,
    generationId: result?.generationId ?? null,
    promptTokens: result?.usage.inputTokens ?? null,
    completionTokens: result?.usage.outputTokens ?? null,
    costUsd: result?.usage.cost ?? null,
    latencyMs: clock() - started,
    error: message,
  });
  return result ? { text: result.text } : { error: error ?? "unexpected" };
}

async function isPrivateFallback(deps: TranscribeDeps, model: string): Promise<boolean> {
  if (!deps.fallbackAllowed) return false;
  try {
    return await deps.fallbackAllowed(model);
  } catch (error) {
    console.warn(`[media] No se ha podido comprobar la privacidad del modelo de respaldo: ${safeErrorMessage(error)}`);
    return false;
  }
}

/** Transcribes one audio. Never throws for the audio itself: the outcome says what happened. */
export async function transcribeAudio(input: TranscribeInput, deps: TranscribeDeps): Promise<TranscribeOutcome> {
  if (input.bytes.byteLength > MEDIA_LIMITS.audioBytes) return { ok: false, reason: "too_large" };
  if (input.bytes.byteLength === 0) return { ok: false, reason: "failed" };
  const clock = deps.clock ?? Date.now;
  const deadline = Math.min(deps.deadlineAt ?? Number.POSITIVE_INFINITY, clock() + TRANSCRIPTION_TIMEOUT_MS);
  const convert = deps.ffmpeg ?? convertToMp3WithFfmpeg;

  const format = transcriptionFormat(input.mimeType);
  const original: Audio | null = format ? { bytes: input.bytes, format } : null;
  // undefined = not tried yet; null = the conversion failed.
  let mp3: Audio | null | undefined;
  const toMp3 = async (): Promise<Audio | null> => {
    if (mp3 !== undefined) return mp3;
    const remaining = deadline - clock();
    try {
      if (remaining <= 0) throw new Error("sin tiempo");
      const bytes = await convert({ bytes: input.bytes, extension: extensionForMime(input.mimeType), mimeType: input.mimeType, timeoutMs: Math.min(FFMPEG_TIMEOUT_MS, remaining) });
      mp3 = { bytes, format: "mp3" };
    } catch (error) {
      console.warn(`[media] No se ha podido convertir un audio a MP3: ${safeErrorMessage(error)}`);
      mp3 = null;
    }
    return mp3;
  };

  for (const [index, model] of transcriptionModels(deps.model).entries()) {
    // The fallback only when it keeps the audio as private as the default does ([CUM-10]).
    if (index > 0 && !(await isPrivateFallback(deps, model))) break;
    // Once converted, the MP3 is what every later try gets.
    let audio = mp3 ?? original ?? (await toMp3());
    while (audio) {
      const remaining = deadline - clock();
      if (remaining <= 0) return { ok: false, reason: "failed" };
      const result = await attempt(input, deps, model, audio, Math.min(TRANSCRIPTION_TIMEOUT_MS, remaining));
      if ("text" in result) return result.text.trim() ? { ok: true, text: result.text.trim(), model } : { ok: false, reason: "empty" };
      if (result.error !== "unexpected" && ACCOUNT_PROBLEM.has(result.error)) return { ok: false, reason: "failed" };
      if (result.error !== "unexpected" && FORMAT_REJECTED.has(result.error) && audio.format !== "mp3") {
        audio = await toMp3();
        continue;
      }
      break;
    }
  }
  return { ok: false, reason: "failed" };
}
