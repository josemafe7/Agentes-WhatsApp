import { asc } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { aiRuns } from "@/db/schema";
import { createOpenRouterClient } from "@/lib/openrouter/client";
import { DEFAULT_MODELS } from "@/lib/openrouter/default-models";
import { FAKE_BASE_URL, FAKE_OPENROUTER_KEY, fakeFetch, jsonResponse, routes, sequence, type FakeCall, type FakeHandler } from "@/test/fake-openrouter";
import type { FfmpegRunner } from "./ffmpeg";
import { MEDIA_LIMITS } from "./limits";
import { TRANSCRIPTION_FALLBACK_MODEL, transcribeAudio } from "./transcribe";

const OGG = new TextEncoder().encode("OggS-voice-note");
const MP3 = new TextEncoder().encode("ID3-converted");
const WHISPER = DEFAULT_MODELS.transcription;

const ok = (text: string, cost = 0.0000137): FakeHandler => () => jsonResponse({ text, usage: { seconds: 4.1, cost } }, 200, { "x-generation-id": "gen-tr-1" });
const rejected: FakeHandler = () => jsonResponse({ error: { code: 400, message: "Unsupported audio format" } }, 400);
const down: FakeHandler = () => jsonResponse({ error: { code: 503, message: "No providers" } }, 503);

function setup(...answers: FakeHandler[]) {
  const fake = fakeFetch(routes({ "POST /audio/transcriptions": sequence(...answers) }));
  const client = createOpenRouterClient({ apiKey: FAKE_OPENROUTER_KEY, baseUrl: FAKE_BASE_URL, fetchImpl: fake.fetch });
  const conversions: { extension: string; bytes: Uint8Array }[] = [];
  const ffmpeg: FfmpegRunner = async ({ bytes, extension }) => {
    conversions.push({ bytes, extension });
    return MP3;
  };
  return { fake, client, conversions, ffmpeg };
}

type Body = { model: string; input_audio: { data: string; format: string }; language?: string; provider?: unknown };
const bodies = (calls: FakeCall[]) => calls.map((call) => call.body as Body);
const runs = () => db.select().from(aiRuns).orderBy(asc(aiRuns.createdAt));
/** The fallback has every provider in the zero-retention list (checked like Settings › IA does, [CUM-10]). */
const privateFallback = async () => true;

beforeEach(async () => {
  await db.delete(aiRuns);
});

describe("transcription of audios [MED-01]", () => {
  it("sends the original voice note to the model of Settings, in Spanish, and records its cost", async () => {
    const { fake, client, conversions, ffmpeg } = setup(ok("Hola, ¿tenéis hueco mañana?"));
    const outcome = await transcribeAudio({ bytes: OGG, mimeType: "audio/ogg; codecs=opus" }, { client, model: WHISPER, ffmpeg });
    expect(outcome).toEqual({ ok: true, text: "Hola, ¿tenéis hueco mañana?", model: WHISPER });
    const [body] = bodies(fake.calls);
    expect(body).toEqual({ model: WHISPER, input_audio: { data: Buffer.from(OGG).toString("base64"), format: "ogg" }, language: "es" });
    // Transcription does not take data_collection or zdr (docs/integracion-openrouter.md §5.1).
    expect(body.provider).toBeUndefined();
    expect(conversions).toHaveLength(0);
    const [run] = await runs();
    expect(run).toMatchObject({ kind: "transcription", modelRequested: WHISPER, modelUsed: WHISPER, costUsd: 0.0000137, generationId: "gen-tr-1", ok: true });
  });

  it("an audio over 25 MB is not sent [MED-03]", async () => {
    const { fake, client, ffmpeg } = setup(ok("nunca"));
    const big = new Uint8Array(MEDIA_LIMITS.audioBytes + 1);
    expect(await transcribeAudio({ bytes: big, mimeType: "audio/ogg" }, { client, model: WHISPER, ffmpeg })).toEqual({ ok: false, reason: "too_large" });
    expect(fake.calls).toHaveLength(0);
  });

  it("with no time left, nothing is sent", async () => {
    const { fake, client, ffmpeg } = setup(ok("nunca"));
    const outcome = await transcribeAudio({ bytes: OGG, mimeType: "audio/ogg" }, { client, model: WHISPER, ffmpeg, deadlineAt: Date.now() - 1 });
    expect(outcome).toEqual({ ok: false, reason: "failed" });
    expect(fake.calls).toHaveLength(0);
  });

  it("silence (an empty transcript) is not tried again with other models", async () => {
    const { fake, client, ffmpeg } = setup(ok("   "));
    expect(await transcribeAudio({ bytes: OGG, mimeType: "audio/ogg" }, { client, model: WHISPER, ffmpeg })).toEqual({ ok: false, reason: "empty" });
    expect(fake.calls).toHaveLength(1);
  });
});

describe("voice notes the model rejects [MED-02]", () => {
  it("rejected as it is: converted to MP3 and sent again to the same model", async () => {
    const { fake, client, conversions, ffmpeg } = setup(rejected, ok("Quería pedir cita"));
    const outcome = await transcribeAudio({ bytes: OGG, mimeType: "audio/ogg" }, { client, model: WHISPER, ffmpeg });
    expect(outcome).toEqual({ ok: true, text: "Quería pedir cita", model: WHISPER });
    expect(conversions).toEqual([{ bytes: OGG, extension: ".ogg" }]);
    expect(bodies(fake.calls).map((body) => [body.model, body.input_audio.format])).toEqual([
      [WHISPER, "ogg"],
      [WHISPER, "mp3"],
    ]);
    expect(bodies(fake.calls)[1].input_audio.data).toBe(Buffer.from(MP3).toString("base64"));
    const recorded = await runs();
    expect(recorded.map((run) => run.ok)).toEqual([false, true]);
    expect(recorded[0].error).toBe("OpenRouter ha rechazado la petición. Revisa el modelo y sus opciones.");
  });

  it("still rejected as MP3: the fallback transcription model is tried", async () => {
    const { fake, client, ffmpeg } = setup(rejected, rejected, ok("Hola"));
    const outcome = await transcribeAudio({ bytes: OGG, mimeType: "audio/ogg" }, { client, model: WHISPER, ffmpeg, fallbackAllowed: privateFallback });
    expect(outcome).toEqual({ ok: true, text: "Hola", model: TRANSCRIPTION_FALLBACK_MODEL });
    expect(bodies(fake.calls).map((body) => [body.model, body.input_audio.format])).toEqual([
      [WHISPER, "ogg"],
      [WHISPER, "mp3"],
      [TRANSCRIPTION_FALLBACK_MODEL, "mp3"],
    ]);
    expect(await runs()).toHaveLength(3);
  });

  it("a format the endpoint does not take is converted before sending", async () => {
    const { fake, client, conversions, ffmpeg } = setup(ok("Hola"));
    await transcribeAudio({ bytes: OGG, mimeType: "audio/amr" }, { client, model: WHISPER, ffmpeg });
    expect(conversions).toHaveLength(1);
    expect(bodies(fake.calls).map((body) => body.input_audio.format)).toEqual(["mp3"]);
  });

  it("the converter gets the audio's stored type, with which FFmpeg's input format is forced [SEG-13]", async () => {
    const client = createOpenRouterClient({ apiKey: FAKE_OPENROUTER_KEY, baseUrl: FAKE_BASE_URL, fetchImpl: fakeFetch(routes({ "POST /audio/transcriptions": ok("Hola") })).fetch });
    const received: (string | null | undefined)[] = [];
    const ffmpeg: FfmpegRunner = async ({ mimeType }) => {
      received.push(mimeType);
      return MP3;
    };
    await transcribeAudio({ bytes: OGG, mimeType: "audio/amr" }, { client, model: WHISPER, ffmpeg });
    expect(received).toEqual(["audio/amr"]);
  });

  it("a failure that is not about the format goes straight to the fallback, without converting", async () => {
    const { fake, client, conversions, ffmpeg } = setup(down, ok("Hola"));
    const outcome = await transcribeAudio({ bytes: OGG, mimeType: "audio/webm" }, { client, model: WHISPER, ffmpeg, fallbackAllowed: privateFallback });
    expect(outcome).toMatchObject({ ok: true, model: TRANSCRIPTION_FALLBACK_MODEL });
    expect(conversions).toHaveLength(0);
    expect(bodies(fake.calls).map((body) => [body.model, body.input_audio.format])).toEqual([
      [WHISPER, "webm"],
      [TRANSCRIPTION_FALLBACK_MODEL, "webm"],
    ]);
  });

  it("if FFmpeg fails, the fallback model gets the original", async () => {
    const { fake, client } = setup(rejected, ok("Hola"));
    const broken: FfmpegRunner = async () => {
      throw new Error("sin ffmpeg");
    };
    const outcome = await transcribeAudio({ bytes: OGG, mimeType: "audio/ogg" }, { client, model: WHISPER, ffmpeg: broken, fallbackAllowed: privateFallback });
    expect(outcome).toMatchObject({ ok: true, model: TRANSCRIPTION_FALLBACK_MODEL });
    expect(bodies(fake.calls).map((body) => body.input_audio.format)).toEqual(["ogg", "ogg"]);
  });

  it("a key or credit problem stops at once: the fallback would fail the same way", async () => {
    const { fake, client, ffmpeg } = setup(() => jsonResponse({ error: { code: 402, message: "Insufficient credits", metadata: { limit_source: "openrouter_credits" } } }, 402));
    expect(await transcribeAudio({ bytes: OGG, mimeType: "audio/ogg" }, { client, model: WHISPER, ffmpeg })).toEqual({ ok: false, reason: "failed" });
    expect(fake.calls).toHaveLength(1);
  });

  it("when every try fails, the audio is not transcribed [MED-03]", async () => {
    const { fake, client, ffmpeg } = setup(rejected);
    expect(await transcribeAudio({ bytes: OGG, mimeType: "audio/ogg" }, { client, model: WHISPER, ffmpeg, fallbackAllowed: privateFallback })).toEqual({ ok: false, reason: "failed" });
    expect(fake.calls).toHaveLength(3);
  });

  it("when Settings already uses the fallback model, the default one is the second try", async () => {
    const { fake, client, ffmpeg } = setup(down, ok("Hola"));
    await transcribeAudio({ bytes: OGG, mimeType: "audio/ogg" }, { client, model: TRANSCRIPTION_FALLBACK_MODEL, ffmpeg, fallbackAllowed: privateFallback });
    expect(bodies(fake.calls).map((body) => body.model)).toEqual([TRANSCRIPTION_FALLBACK_MODEL, WHISPER]);
  });
});

describe("the fallback never lowers the privacy of the audio [CUM-10] [MED-02]", () => {
  it("is not tried when some of its providers keep data: the audio is not transcribed", async () => {
    const asked: string[] = [];
    const { fake, client, ffmpeg } = setup(rejected, rejected, ok("Hola"));
    const fallbackAllowed = async (model: string) => {
      asked.push(model);
      return false;
    };
    expect(await transcribeAudio({ bytes: OGG, mimeType: "audio/ogg" }, { client, model: WHISPER, ffmpeg, fallbackAllowed })).toEqual({ ok: false, reason: "failed" });
    expect(asked).toEqual([TRANSCRIPTION_FALLBACK_MODEL]);
    expect(bodies(fake.calls).map((body) => body.model)).toEqual([WHISPER, WHISPER]);
  });

  it("without a way to know its privacy, the fallback is not tried", async () => {
    const { fake, client, ffmpeg } = setup(down, ok("Hola"));
    expect(await transcribeAudio({ bytes: OGG, mimeType: "audio/ogg" }, { client, model: WHISPER, ffmpeg })).toEqual({ ok: false, reason: "failed" });
    expect(bodies(fake.calls).map((body) => body.model)).toEqual([WHISPER]);
  });
});
