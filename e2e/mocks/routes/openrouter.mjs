// OpenRouter default answers (docs/integracion-openrouter.md). OPENROUTER_BASE_URL points at
// <mock>/openrouter/api/v1, so paths here keep the real "/api/v1/…" shape.
import { readFileSync } from "node:fs";

const KEYS = JSON.parse(readFileSync(new URL("../test-keys.json", import.meta.url), "utf8")).openrouter;

/** GET /api/v1/key body for a working key (docs/integracion-openrouter.md §1). */
function keyData(overrides = {}) {
  return {
    data: {
      label: "Pruebas e2e",
      limit: 100,
      limit_remaining: 74.5,
      limit_reset: "monthly",
      usage: 25.5,
      usage_daily: 25.5,
      usage_weekly: 25.5,
      usage_monthly: 25.5,
      byok_usage: 0,
      include_byok_in_limit: false,
      is_free_tier: false,
      is_management_key: false,
      expires_at: "2099-12-31T23:59:59Z",
      free_model_daily_requests: { used: 0, limit: 50, remaining: 50 },
      workspace_id: "00000000-0000-4000-8000-000000000e2e",
      organization_id: null,
      allowed_data_regions: ["global", "europe", "us"],
      rate_limit: { requests: 1000, interval: "1h", note: "This field is deprecated and safe to ignore." },
      ...overrides,
    },
  };
}

const KEY_ANSWERS = new Map([
  [KEYS.valid, () => keyData()],
  [KEYS.freeTier, () => keyData({ is_free_tier: true, limit: null, limit_remaining: null, limit_reset: null })],
  [KEYS.management, () => keyData({ is_management_key: true })],
]);

function bearer(headers) {
  const value = headers.authorization;
  if (typeof value !== "string") return null;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match ? match[1].trim() : null;
}

/** @type {import("../server.mjs").MockRoute[]} */
export const openrouterRoutes = [
  {
    method: "GET",
    path: "/api/v1/key",
    handle: ({ headers }) => {
      const key = bearer(headers);
      if (!key) return { status: 401, body: { error: { code: 401, message: "Missing Authentication header" } } };
      const answer = KEY_ANSWERS.get(key);
      if (!answer) return { status: 401, body: { error: { code: 401, message: "User not found." } } };
      return { status: 200, body: answer() };
    },
  },
];
