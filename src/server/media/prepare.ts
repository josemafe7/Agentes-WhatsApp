// Prepares the conversation for the model ([MOT-04], [MED-01]–[MED-07]): audios as their transcript (transcribed
// once and saved on the message), images as they are for models that see them or described once by the cheap vision
// model, PDFs as a file for models that open them or as their text, other files only named. The reply engine calls
// it with the last messages (oldest first) right before runAgent. Every OpenRouter call is recorded in ai_runs.
// It never throws for a file it cannot read: the message says so instead ([MED-03]).
import "server-only";
import { and, eq, like, ne } from "drizzle-orm";
import { db } from "@/db";
import { messages, type MessageMedia } from "@/db/schema";
import type { MessageContentType, SenderType } from "@/lib/enums";
import { imagePart, pdfPart, type OpenRouterClient } from "@/lib/openrouter/client";
import type { ModelSupport } from "@/lib/openrouter/types";
import { getFileStorage, type FileStorage } from "@/server/adapters/file-storage";
import { AiNotConfiguredError } from "@/server/ai/errors";
import { catalogSupport, getTranscriptionPrivacy } from "@/server/ai/models";
import { getOpenRouterClient, isZdrEnabled, resolveDefaultModels, type ResolvedDefaultModels } from "@/server/ai/openrouter";
import type { PromptHistoryMessage } from "@/server/ai/prompt";
import { safeErrorMessage } from "@/server/redact";
import { describeImage } from "./describe-image";
import type { FfmpegRunner } from "./ffmpeg";
import { baseMimeType, isModelImageType, isPdf, MEDIA_LIMITS } from "./limits";
import { mediaMetadataOf, type MediaMetadataPatch } from "./metadata";
import { extractPdfText } from "./pdf";
import { readStoredMedia, type ReadMediaResult } from "./store";
import { transcribeAudio } from "./transcribe";

/** Newest images sent as images, and newest PDFs read, in one turn: older ones go as their saved text. */
export const MAX_IMAGES_FOR_MODEL = 3;
export const MAX_DOCUMENTS_FOR_MODEL = 2;

/** A stored message as the engine loads it. */
export type ModelInputMessage = {
  id: string;
  senderType: SenderType;
  contentType: MessageContentType;
  text: string | null;
  transcript: string | null;
  media: MessageMedia | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
};

export type PrepareContext = {
  conversationId: string;
  channelId: string;
  /** Agent of the turn, for ai_runs; null when none will answer (the team still gets the transcripts). */
  agentId: string | null;
  /** Model that will answer: decides whether images and PDFs go as they are ([MED-05], [MED-06]). Empty = default. */
  model: string;
  /** Tests inject a fake fetch for transcription and image description (never the real OpenRouter). */
  fetchImpl?: typeof fetch;
  /** What that model takes (image, file); read from the model catalogue when omitted. */
  support?: ModelSupport | null;
  /** Epoch ms by which the media work must end (the job's budget); each audio has 60 s at most anyway. */
  deadlineAt?: number;
  /** Tests: a fake MP3 converter instead of FFmpeg. */
  ffmpeg?: FfmpegRunner;
  /** Tests: a storage of their own. */
  storage?: FileStorage;
};

type Ai = { client: OpenRouterClient; defaults: ResolvedDefaultModels; zdr: boolean; support: ModelSupport | null };

type Turn = {
  context: PrepareContext;
  storage: FileStorage;
  /** The OpenRouter client and settings, looked up once and only when a file needs them; null without a key. */
  ai: () => Promise<Ai | null>;
  /** Ids of the images and PDFs worth sending or reading in full this turn. */
  recent: ReadonlySet<string>;
};

/** The messages as the prompt receives them. */
export async function prepareMessagesForModel(messages: readonly ModelInputMessage[], context: PrepareContext): Promise<PromptHistoryMessage[]> {
  const turn: Turn = { context, storage: context.storage ?? getFileStorage(), ai: lazyAi(context), recent: recentMedia(messages) };
  return Promise.all(messages.map((message) => prepareOne(message, turn)));
}

/**
 * Transcribes the customer's voice notes that still have no transcript, before anything else of the turn: the
 * agent's hand-off rules then read what was said ([TRA-01]), and when the AI will not answer (paused, off, handed
 * off, no agent…) the team still reads it under the player ([MED-04]). Without a key nothing is sent ([ARR-14]).
 * Returns how many were transcribed. Runs in the reply job, never in a request ([CAN-10]).
 */
export async function transcribePendingAudio(messages: readonly ModelInputMessage[], context: PrepareContext): Promise<number> {
  const audio = messages.filter(
    (message) =>
      message.senderType === "contact" && message.contentType === "audio" && message.media && !message.transcript?.trim() && !mediaMetadataOf(message.metadata).transcriptionFailed,
  );
  if (audio.length === 0) return 0;
  // Transcription does not depend on the answering model: no catalogue lookup.
  const turn: Turn = { context, storage: context.storage ?? getFileStorage(), ai: lazyAi({ ...context, support: null }), recent: new Set() };
  let transcribed = 0;
  for (const message of audio) {
    if (!message.media) continue;
    try {
      if ((await prepareAudio(message, message.media, turn)).transcript) transcribed += 1;
    } catch (error) {
      console.warn(`[media] No se ha podido transcribir una nota de voz: ${safeErrorMessage(error)}`);
    }
  }
  return transcribed;
}

function baseOf(message: ModelInputMessage): PromptHistoryMessage {
  return {
    role: message.senderType,
    text: message.text,
    contentType: message.contentType,
    transcript: message.transcript,
    fileName: message.media?.fileName ?? null,
  };
}

function lazyAi(context: PrepareContext): () => Promise<Ai | null> {
  let pending: Promise<Ai | null> | undefined;
  const load = async (): Promise<Ai | null> => {
    try {
      const client = await getOpenRouterClient({ fetchImpl: context.fetchImpl });
      const [defaults, zdr] = await Promise.all([resolveDefaultModels(), isZdrEnabled()]);
      const support = context.support !== undefined ? context.support : await catalogSupport(client, context.model || defaults.chat);
      return { client, defaults, zdr, support };
    } catch (error) {
      // Without a key nothing is sent; the files are processed on a later turn that has one.
      if (error instanceof AiNotConfiguredError) return null;
      throw error;
    }
  };
  return () => (pending ??= load());
}

function recentMedia(messages: readonly ModelInputMessage[]): Set<string> {
  const ids = new Set<string>();
  let images = 0;
  let documents = 0;
  for (const message of [...messages].reverse()) {
    if (message.senderType !== "contact" || !message.media?.fileKey) continue;
    if (message.contentType === "image" && images < MAX_IMAGES_FOR_MODEL) {
      ids.add(message.id);
      images += 1;
    } else if (message.contentType === "document" && isPdf(message.media.mimeType, message.media.fileName) && documents < MAX_DOCUMENTS_FOR_MODEL) {
      ids.add(message.id);
      documents += 1;
    }
  }
  return ids;
}

async function prepareOne(message: ModelInputMessage, turn: Turn): Promise<PromptHistoryMessage> {
  const base = baseOf(message);
  // Only the customer's files are processed: the team's own files need nothing.
  if (message.senderType !== "contact" || !message.media) return base;
  try {
    switch (message.contentType) {
      case "audio":
        return await prepareAudio(message, message.media, turn);
      case "image":
        return await prepareImage(message, message.media, turn);
      case "document":
        return await prepareDocument(message, message.media, turn);
      default:
        return base;
    }
  } catch (error) {
    console.warn(`[media] No se ha podido preparar un archivo para la IA: ${safeErrorMessage(error)}`);
    return base;
  }
}

/**
 * The bytes of a message's own file. A key that another conversation's message also uses is never read: a visitor
 * must not get the AI to describe someone else's file ([WEB-11]).
 */
async function readOwnMedia(fileKey: string, maxBytes: number, turn: Turn): Promise<ReadMediaResult> {
  const others = await db
    .select({ media: messages.media })
    .from(messages)
    .where(and(ne(messages.conversationId, turn.context.conversationId), like(messages.media, `%${JSON.stringify(fileKey)}%`)))
    .limit(20);
  if (others.some((row) => row.media?.fileKey === fileKey)) {
    console.warn("[media] Un mensaje usa un archivo de otra conversación: no se envía a la IA.");
    return { ok: false, reason: "missing" };
  }
  return readStoredMedia(fileKey, maxBytes, turn.storage);
}

async function saveMediaMetadata(messageId: string, patch: MediaMetadataPatch): Promise<void> {
  const [current] = await db.select({ metadata: messages.metadata }).from(messages).where(eq(messages.id, messageId));
  await db
    .update(messages)
    .set({ metadata: { ...(current?.metadata ?? {}), ...patch } })
    .where(eq(messages.id, messageId));
}

const runIds = (message: ModelInputMessage, turn: Turn) => ({ conversationId: turn.context.conversationId, messageId: message.id, agentId: turn.context.agentId });

async function prepareAudio(message: ModelInputMessage, media: MessageMedia, turn: Turn): Promise<PromptHistoryMessage> {
  const base = baseOf(message);
  if (message.transcript?.trim()) return base;
  if (mediaMetadataOf(message.metadata).transcriptionFailed) return { ...base, transcriptFailed: true };
  // Saved once: «No se pudo transcribir» in the inbox, and never tried again ([MED-03]).
  const failed = async (): Promise<PromptHistoryMessage> => {
    await saveMediaMetadata(message.id, { transcriptionFailed: true });
    return { ...base, transcriptFailed: true };
  };
  if (media.downloadStatus === "failed") return failed();
  if (!media.fileKey) return base;
  if ((media.size ?? 0) > MEDIA_LIMITS.audioBytes) return failed();
  const ai = await turn.ai();
  if (!ai) return base;
  const file = await readOwnMedia(media.fileKey, MEDIA_LIMITS.audioBytes, turn);
  if (!file.ok) return failed();
  const outcome = await transcribeAudio(
    { bytes: file.bytes, mimeType: media.mimeType ?? file.contentType, ...runIds(message, turn) },
    {
      client: ai.client,
      model: ai.defaults.transcription,
      ffmpeg: turn.context.ffmpeg,
      deadlineAt: turn.context.deadlineAt,
      // Same check as the warning of Settings › IA (kept 12 h per model): the fallback only if it is zero-retention.
      fallbackAllowed: async (model) => (await getTranscriptionPrivacy(model, { client: ai.client })).status === "zdr",
    },
  );
  if (!outcome.ok) return failed();
  // With the time it was transcribed: the audio's retention days count from it ([CUM-05]).
  const [current] = await db.select({ metadata: messages.metadata }).from(messages).where(eq(messages.id, message.id));
  const patch: MediaMetadataPatch = { transcribedAt: new Date().toISOString() };
  await db
    .update(messages)
    .set({ transcript: outcome.text, metadata: { ...(current?.metadata ?? {}), ...patch } })
    .where(eq(messages.id, message.id));
  return { ...base, transcript: outcome.text };
}

async function prepareImage(message: ModelInputMessage, media: MessageMedia, turn: Turn): Promise<PromptHistoryMessage> {
  const base = baseOf(message);
  const saved = mediaMetadataOf(message.metadata);
  const described = saved.imageDescription ? { ...base, mediaDescription: saved.imageDescription } : base;
  const mimeType = media.mimeType ?? null;
  if (!media.fileKey || !turn.recent.has(message.id) || !isModelImageType(mimeType) || (media.size ?? 0) > MEDIA_LIMITS.imageBytes) return described;
  const ai = await turn.ai();
  if (!ai) return described;

  if (ai.support?.inputModalities.includes("image")) {
    const file = await readOwnMedia(media.fileKey, MEDIA_LIMITS.imageBytes, turn);
    return file.ok ? { ...base, parts: [imagePart(file.bytes, baseMimeType(mimeType ?? file.contentType))] } : described;
  }
  if (saved.imageDescription || saved.imageDescriptionFailed) return described;
  const file = await readOwnMedia(media.fileKey, MEDIA_LIMITS.imageBytes, turn);
  if (!file.ok) return base;
  const description = await describeImage(
    { bytes: file.bytes, mimeType: mimeType ?? file.contentType, ...runIds(message, turn) },
    { client: ai.client, model: ai.defaults.imageDescription, zdr: ai.zdr },
  );
  await saveMediaMetadata(message.id, description ? { imageDescription: description } : { imageDescriptionFailed: true });
  return description ? { ...base, mediaDescription: description } : base;
}

async function prepareDocument(message: ModelInputMessage, media: MessageMedia, turn: Turn): Promise<PromptHistoryMessage> {
  const base = baseOf(message);
  // Only recent PDFs are read ([MED-06]); other documents are only named, like any other file ([MED-07]).
  if (!media.fileKey || !turn.recent.has(message.id)) return base;
  // Without a key there is no support information: the text is read, which any model takes.
  const ai = await turn.ai();
  const file = await readOwnMedia(media.fileKey, MEDIA_LIMITS.documentBytes, turn);
  if (!file.ok) return base;
  if (ai?.support?.inputModalities.includes("file")) return { ...base, parts: [pdfPart(file.bytes, media.fileName ?? "documento.pdf")] };
  const text = await extractPdfText(file.bytes);
  return text ? { ...base, documentText: text } : base;
}
