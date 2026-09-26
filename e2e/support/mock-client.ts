// Client for the test API of e2e/mocks/server.mjs: reset it, add per-test answers and inspect what the app
// called. Service paths are relative to the service prefix (OpenRouter's key check is "/api/v1/key").
import { MOCK_URL } from "./env";

export type MockService = "openrouter" | "meta" | "google-oauth" | "google" | "ms-login" | "ms-graph" | "mistral" | "telegram";

export type MockStub = {
  service: MockService;
  method?: string;
  /** Relative to the service prefix; `*` matches one segment and `**` the rest. */
  path: string;
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  /** How many times it answers (default: always). */
  times?: number;
  delayMs?: number;
  when?: { headers?: Record<string, string>; query?: Record<string, string>; bodyIncludes?: string };
};

export type MockRecordedRequest = {
  id: number;
  at: string;
  service: MockService;
  method: string;
  path: string;
  query: Record<string, string>;
  /** Lower-case header names. */
  headers: Record<string, string>;
  body: unknown;
  answeredBy: "stub" | "default" | "none";
  status: number;
};

export class MockClient {
  constructor(private readonly baseUrl: string = MOCK_URL) {}

  private async call(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, init);
    const body: unknown = await response.json();
    if (!response.ok) throw new Error(`Mock ${path} → ${response.status}: ${JSON.stringify(body)}`);
    return body;
  }

  /** Forgets every stub and recorded request. */
  async reset(): Promise<void> {
    await this.call("/__reset", { method: "POST" });
  }

  async stub(stub: MockStub): Promise<void> {
    await this.call("/__stub", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(stub),
    });
  }

  async requests(filter: { service?: MockService; method?: string; path?: string } = {}): Promise<MockRecordedRequest[]> {
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(filter)) if (value) query.set(name, value);
    const body = (await this.call(`/__requests?${query.toString()}`)) as { requests: MockRecordedRequest[] };
    return body.requests;
  }
}
