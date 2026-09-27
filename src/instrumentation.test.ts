import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resume = vi.hoisted(() => vi.fn<() => Promise<boolean>>());
vi.mock("./server/knowledge/maintenance", () => ({ resumePendingEmbeddings: resume }));

import { register } from "./instrumentation";

beforeEach(() => {
  resume.mockReset();
  resume.mockResolvedValue(true);
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
});
afterEach(() => vi.unstubAllEnvs());

describe("server start-up", () => {
  it("[CON-12] [ARR-15] looks for embeddings left pending, so a key in .env.local counts once the app restarts", async () => {
    await register();
    await vi.waitFor(() => expect(resume).toHaveBeenCalledTimes(1));
  });

  it("never stops the app from starting if that look fails, and does nothing while building", async () => {
    resume.mockRejectedValue(new Error("base de datos no disponible"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(register()).resolves.toBeUndefined();
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    warn.mockRestore();

    resume.mockClear();
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    await register();
    expect(resume).not.toHaveBeenCalled();
  });
});
