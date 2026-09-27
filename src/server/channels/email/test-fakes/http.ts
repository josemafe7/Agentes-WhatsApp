// Shared by the fake services of the email tests: recorded calls and JSON answers.
import "server-only";

export type RecordedCall = { method: string; url: URL; headers: Headers; body: string | null };

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function record(calls: RecordedCall[], input: string | URL | Request, init?: RequestInit): Promise<RecordedCall> {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const body = typeof init?.body === "string" ? init.body : null;
  const call = { method: (init?.method ?? "GET").toUpperCase(), url, headers: new Headers(init?.headers), body };
  calls.push(call);
  return call;
}

