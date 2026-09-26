import { describe, expect, it } from "vitest";
import { LibsqlRateLimiter } from "@/server/adapters/rate-limiter";
import { RateLimitError } from "@/server/errors";
import { AI_RATE_LIMITS, enforceAiRateLimit } from "./limits";

describe("limits on what spends AI [SEG-07]", () => {
  it("lets a person generate a few drafts per minute, then refuses with a Spanish message; others are not affected", async () => {
    let now = new Date("2026-09-26T10:00:00Z");
    const limiter = new LibsqlRateLimiter({ now: () => now });
    const person = crypto.randomUUID();
    for (let i = 0; i < AI_RATE_LIMITS.generate.limit; i++) await enforceAiRateLimit("generate", person, limiter);
    await expect(enforceAiRateLimit("generate", person, limiter)).rejects.toBeInstanceOf(RateLimitError);
    await expect(enforceAiRateLimit("generate", person, limiter)).rejects.toThrow(/Espera un minuto/);
    await expect(enforceAiRateLimit("generate", crypto.randomUUID(), limiter)).resolves.toBeUndefined();
    await expect(enforceAiRateLimit("test", person, limiter)).resolves.toBeUndefined();
    now = new Date(now.getTime() + AI_RATE_LIMITS.generate.windowMs);
    await expect(enforceAiRateLimit("generate", person, limiter)).resolves.toBeUndefined();
  });
});
