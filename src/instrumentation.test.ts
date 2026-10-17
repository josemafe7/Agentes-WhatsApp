import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const resume = vi.hoisted(() => vi.fn<() => Promise<boolean>>());
vi.mock("./server/knowledge/maintenance", () => ({ resumePendingEmbeddings: resume }));

import { register } from "./instrumentation";
import { setQrSupervisorForTests, type QrSupervisor } from "./server/channels/whatsapp-qr/runtime";
import { resetStartupMaintenanceForTests } from "./server/startup-maintenance";

// Each test is a new start of the server. The start-up upkeep runs once per process (src/server/startup-maintenance.ts),
// so after each test it is waited for — nothing it started is still using this file's database when it closes — and
// forgotten. The WhatsApp numbers linked by QR code are resumed by a supervisor of the test, for the whole file: the
// real one loads WhatsApp's library and would read this file's database after its tests have ended.
beforeAll(() => setQrSupervisorForTests({ startAll: async () => undefined } as unknown as QrSupervisor));
afterAll(() => setQrSupervisorForTests(null));

beforeEach(() => {
  resume.mockReset();
  resume.mockResolvedValue(true);
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
});
afterEach(async () => {
  await resetStartupMaintenanceForTests();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("server start-up", () => {
  it("[CON-12] [ARR-15] looks for embeddings left pending, so a key in .env.local counts once the app restarts", async () => {
    await register();
    await vi.waitFor(() => expect(resume).toHaveBeenCalledTimes(1));
  });

  it("does not wait for the start-up upkeep: the app is ready while it still runs", async () => {
    let release: (value: boolean) => void = () => undefined;
    resume.mockImplementation(() => new Promise<boolean>((resolve) => (release = resolve)));
    // If the start waited for the upkeep, this would never resolve and the test would time out.
    await expect(register()).resolves.toBeUndefined();
    await vi.waitFor(() => expect(resume).toHaveBeenCalledTimes(1));
    release(true);
  });

  it("never stops the app from starting if that look fails, and does nothing while building", async () => {
    resume.mockRejectedValue(new Error("base de datos no disponible"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(register()).resolves.toBeUndefined();
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining("No se han podido revisar los embeddings pendientes")));
    warn.mockRestore();

    // `next build` is a process of its own: nothing of the start above counts for it.
    await resetStartupMaintenanceForTests();
    resume.mockClear();
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    await register();
    expect(resume).not.toHaveBeenCalled();
  });

  it("[SEG-03] without a usable encryption key it does not start, and says why without the value", async () => {
    vi.stubEnv("APP_ENCRYPTION_KEY", "corta");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(register()).rejects.toThrow(/APP_ENCRYPTION_KEY/);
    expect(error.mock.calls.join(" ")).not.toContain("corta");
    expect(resume).not.toHaveBeenCalled();
  });
});

describe("a published app (NODE_ENV=production) refuses an unsafe configuration [SEG-11]", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "https://agentes.mipeluqueria.es");
    vi.stubEnv("BETTER_AUTH_URL", "https://agentes.mipeluqueria.es");
  });

  it("starts with https addresses and the real services", async () => {
    await expect(register()).resolves.toBeUndefined();
  });

  it("does not start with an http APP_URL, and says it in Spanish", async () => {
    vi.stubEnv("APP_URL", "http://agentes.mipeluqueria.es");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(register()).rejects.toThrow(/APP_URL tiene que ser la dirección pública de la app con https:\/\//);
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/^\[arranque\] La app no puede arrancar\. APP_URL/));
    expect(resume).not.toHaveBeenCalled();
  });

  it("does not start with an external service pointed somewhere else, naming the variable but never its value", async () => {
    vi.stubEnv("OPENROUTER_BASE_URL", "https://otro-servidor.example/api/v1");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(register()).rejects.toThrow(/OPENROUTER_BASE_URL/);
    expect(error.mock.calls.join(" ")).not.toContain("otro-servidor");
  });

  it("the Playwright servers start with http://localhost and the mock services thanks to E2E_ALLOW_BASE_URL_OVERRIDES", async () => {
    vi.stubEnv("APP_URL", "http://localhost:3100");
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3100");
    vi.stubEnv("META_GRAPH_BASE_URL", "http://127.0.0.1:3101/meta");
    vi.stubEnv("E2E_ALLOW_BASE_URL_OVERRIDES", "true");
    await expect(register()).resolves.toBeUndefined();
  });

  it("`next build` is not stopped: the address is checked when the compiled app starts", async () => {
    vi.stubEnv("APP_URL", "http://localhost:3000");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    await expect(register()).resolves.toBeUndefined();
  });

  it("[SEG-07] does not start with an invalid TRUSTED_PROXY_HOPS", async () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "muchos");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(register()).rejects.toThrow(/TRUSTED_PROXY_HOPS/);
  });
});
