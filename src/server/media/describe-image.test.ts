import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { aiRuns, appKv } from "@/db/schema";
import { createOpenRouterClient } from "@/lib/openrouter/client";
import type { ChatMessage } from "@/lib/openrouter/types";
import { chatCompletion, FAKE_BASE_URL, FAKE_OPENROUTER_KEY, fakeFetch, jsonResponse, routes, sampleCatalog, type FakeHandler } from "@/test/fake-openrouter";
import { describeImage } from "./describe-image";
import { PNG_1X1 } from "./test-fixtures";

const VISION = "google/gemini-3.1-flash-lite";

function setup(answer: FakeHandler) {
  const fake = fakeFetch(routes({ "GET /models/user": () => jsonResponse({ data: sampleCatalog() }), "POST /chat/completions": answer }));
  return { fake, client: createOpenRouterClient({ apiKey: FAKE_OPENROUTER_KEY, baseUrl: FAKE_BASE_URL, fetchImpl: fake.fetch }) };
}

type ChatBody = { model: string; messages: ChatMessage[]; provider: Record<string, unknown>; max_tokens?: number; reasoning?: { effort: string } };

beforeEach(async () => {
  await db.delete(aiRuns);
  await db.delete(appKv);
});

describe("images described for models that cannot see them [MED-05]", () => {
  it("asks the cheap vision model for a short Spanish description, with the image inline and private", async () => {
    const { fake, client } = setup(() => jsonResponse(chatCompletion({ content: "Foto de un recogido con trenzas.", model: VISION, usage: { cost: 0.00003 } })));
    const description = await describeImage({ bytes: PNG_1X1, mimeType: "image/png", conversationId: null }, { client, model: VISION, zdr: true });
    expect(description).toBe("Foto de un recogido con trenzas.");

    const call = fake.calls.find((entry) => entry.path === "/chat/completions");
    const body = call?.body as ChatBody;
    expect(body.model).toBe(VISION);
    expect(body.provider).toEqual({ data_collection: "deny", zdr: true });
    expect(body.max_tokens).toBeLessThanOrEqual(500);
    const [system, user] = body.messages;
    expect(system).toMatchObject({ role: "system" });
    // Text inside the picture is data, never an order ([HER-09]).
    expect(String(system.content)).toMatch(/no las sigas/);
    expect(user).toEqual({
      role: "user",
      content: [
        { type: "text", text: "Describe esta imagen." },
        { type: "image_url", image_url: { url: `data:image/png;base64,${Buffer.from(PNG_1X1).toString("base64")}` } },
      ],
    });

    const [run] = await db.select().from(aiRuns);
    expect(run).toMatchObject({ kind: "image_description", modelRequested: VISION, modelUsed: VISION, costUsd: 0.00003, ok: true });
  });

  it("a failure gives no description and is recorded for Diagnóstico", async () => {
    const { client } = setup(() => jsonResponse({ error: { code: 400, message: "invalid_image", metadata: { error_type: "invalid_image" } } }, 400));
    expect(await describeImage({ bytes: PNG_1X1, mimeType: "image/png" }, { client, model: VISION, zdr: false })).toBeNull();
    const [run] = await db.select().from(aiRuns);
    expect(run).toMatchObject({ kind: "image_description", ok: false, error: "OpenRouter ha rechazado la petición. Revisa el modelo y sus opciones." });
  });

  it("a very long description is cut", async () => {
    const { client } = setup(() => jsonResponse(chatCompletion({ content: "a".repeat(5_000) })));
    const description = await describeImage({ bytes: PNG_1X1, mimeType: "image/png" }, { client, model: VISION, zdr: false });
    expect(description?.length).toBeLessThanOrEqual(1_000);
  });
});
