// The start-up checks shared by the web server and `pnpm worker` ([SEG-03], [SEG-11]): same rules, same messages.
import { afterEach, describe, expect, it, vi } from "vitest";
import { EncryptionKeyError } from "./crypto";
import { checkStartupConfig, isStartupConfigError } from "./startup-checks";

afterEach(() => vi.unstubAllEnvs());

function errorOf(run: () => unknown): unknown {
  try {
    run();
    return null;
  } catch (error) {
    return error;
  }
}

describe("start-up checks of every server process", () => {
  it("without a usable encryption key nothing starts, and the message never shows the value", () => {
    vi.stubEnv("APP_ENCRYPTION_KEY", "corta");
    const error = errorOf(() => checkStartupConfig());
    expect(error).toBeInstanceOf(EncryptionKeyError);
    expect(isStartupConfigError(error)).toBe(true);
    expect(String((error as Error).message)).not.toContain("corta");
  });

  it("a compiled app with an unsafe configuration does not start; while building, only the key is checked", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "http://agentes.mipeluqueria.es");
    vi.stubEnv("BETTER_AUTH_URL", "");
    expect(isStartupConfigError(errorOf(() => checkStartupConfig()))).toBe(true);
    expect(checkStartupConfig({ building: true })).toEqual([]);
  });

  it("a compiled app on this computer starts and says it only works here", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "http://localhost:3000");
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    vi.stubEnv("E2E_ALLOW_BASE_URL_OVERRIDES", "");
    for (const name of ["OPENROUTER_BASE_URL", "META_GRAPH_BASE_URL", "GOOGLE_OAUTH_BASE_URL", "GOOGLE_API_BASE_URL", "MS_LOGIN_BASE_URL", "MS_GRAPH_BASE_URL", "MISTRAL_BASE_URL", "TELEGRAM_API_BASE_URL", "ALLOW_LOCAL_HTTP_TOOLS"]) {
      vi.stubEnv(name, "");
    }
    expect(checkStartupConfig()).toEqual([expect.stringMatching(/solo se puede usar en este ordenador/)]);
  });

  it("anything else is not a configuration problem", () => {
    expect(isStartupConfigError(new Error("otra cosa"))).toBe(false);
  });
});
