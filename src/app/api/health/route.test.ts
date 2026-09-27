import { describe, expect, it, vi } from "vitest";
import { GET } from "./route";

describe("/api/health [ARR-21]", () => {
  it("reports the app and the database without private data", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ status: "ok", database: "ok" });
    expect(typeof body.version).toBe("string");
    expect(Object.keys(body).sort()).toEqual(["database", "databaseLatencyMs", "status", "version"]);
  });

  it("answers 503 when the database does not respond", async () => {
    vi.resetModules();
    vi.doMock("@/server/adapters/database-health", () => ({
      pingDatabase: async () => {
        throw new Error("unreachable postgresql://postgres.abcd:secret-token@aws-0-eu-west-1.pooler.supabase.com:6543/postgres");
      },
    }));
    const { GET: failingGet } = await import("./route");
    const response = await failingGet();
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
    vi.doUnmock("@/server/adapters/database-health");
  });
});
